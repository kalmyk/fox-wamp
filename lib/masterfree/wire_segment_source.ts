import { HyperClient } from '../hyper/client'
import { HyperNetClient } from '../hyper/net_transport'
import { SEGMENT_COMMITTED, CommittedSegmentEvent, SegmentCommittedSource } from './segment_types'
import { Event, INTRA_REALM_NAME, BODY_SEGMENT_COMMITTED } from './hyper.h'

// One outbound connection to an entry node, as WireSegmentCommittedSource sees it.
export interface WireLink {
  readonly name: string
  isConnected (): boolean
  // registers the handler that receives every Event.SEGMENT_COMMITTED delivered on this link
  onSegmentCommitted (handler: (body: BODY_SEGMENT_COMMITTED) => void): void
  // fires whenever isConnected() flips
  onStateChange (cb: () => void): void
  // client for RPC calls (history fetch) while connected
  getClient (): HyperClient | undefined
}

// WireLink over a real HyperNetClient: connects, logs into the sys realm and subscribes to the
// wire Event.SEGMENT_COMMITTED broadcast that every storage node already pipes to every entry
// (EventStorageTask.listenEntry). HyperNetClient reconnects by itself and re-runs onopen, which
// logs in and subscribes again on the fresh session.
export class HyperNetEntryLink implements WireLink {
  private client: HyperNetClient
  private connected = false
  private handlers: Array<(body: BODY_SEGMENT_COMMITTED) => void> = []
  private stateCallbacks: Array<() => void> = []

  constructor (readonly name: string, host: string, port: number) {
    this.client = new HyperNetClient({ host, port })
    this.client.onopen(async () => {
      try {
        await this.client.login({ realm: INTRA_REALM_NAME })
        await this.client.subscribe(Event.SEGMENT_COMMITTED, (body: BODY_SEGMENT_COMMITTED) => {
          for (const handler of this.handlers) handler(body)
        })
        this.setConnected(true)
      } catch (err) {
        console.error('kvnode: failed to attach to entry', this.name, (err as Error).message)
      }
    })
    this.client.getSocket().on('close', () => this.setConnected(false))
  }

  connect (): Promise<unknown> {
    return this.client.connect()
  }

  close (): void {
    this.client.close()
  }

  isConnected (): boolean {
    return this.connected
  }

  onSegmentCommitted (handler: (body: BODY_SEGMENT_COMMITTED) => void): void {
    this.handlers.push(handler)
  }

  onStateChange (cb: () => void): void {
    this.stateCallbacks.push(cb)
  }

  getClient (): HyperClient | undefined {
    return this.connected ? this.client : undefined
  }

  private setConnected (value: boolean): void {
    if (this.connected === value) return
    this.connected = value
    for (const cb of this.stateCallbacks) cb()
  }
}

// SegmentCommittedSource for a standalone KV-node: it feeds ProjectionListener from the wire
// SEGMENT_COMMITTED broadcast of one or more entry nodes instead of a storage node's local
// in-process emitter, which only reflects that node's own shards (see add-kv-node-process
// design.md Context).
//
// Multi-entry attachment is active/standby: exactly one link drives ProjectionListener at a time.
// Deliveries on a standby link are discarded, never queued — queuing would reintroduce the
// out-of-order redelivery it exists to prevent once the queue drained after a promotion. When the
// active link drops, the first still-connected standby is promoted; a link that comes back stays
// standby until the active one drops.
//
// INTERIM ordering guard (add-kv-node-process design.md Decision 7): the SEGMENT_COMMITTED fan-in
// on an entry has no cross-shard ordering, so even a single active link can deliver a smaller
// eventId after a larger one, and ProjectionListener/KvProjection.advancePosition would apply it
// as received. Until the shared marker-then-fetch component from
// openspec/changes/live-dispatch-eventid-ordering (its task 5.5) replaces it, this drops — never
// buffers — any record not above the highest eventId already forwarded for its realm. State is one
// string per realm plus one global segment string, so it is bounded by realm count, not volume.
// Shipping that sibling change alone does NOT remove this guard: it orders NetEngineMill's own
// dispatch, not the raw broadcast this class subscribes to. Replace it by adopting the component.
export class WireSegmentCommittedSource implements SegmentCommittedSource {
  private listeners: Array<(event: CommittedSegmentEvent) => void> = []
  private active: WireLink | null = null
  private highWater: Map<string, string> = new Map()
  private lastSegment = ''

  constructor (private links: WireLink[], private warn: (msg: string) => void = (msg) => console.warn(msg)) {
    for (const link of links) {
      link.onSegmentCommitted((body) => this.deliver(link, body))
      link.onStateChange(() => this.reelect())
    }
    this.reelect()
  }

  on (event: typeof SEGMENT_COMMITTED, listener: (event: CommittedSegmentEvent) => void): this {
    if (event === SEGMENT_COMMITTED) {
      this.listeners.push(listener)
    }
    return this
  }

  // The RPC client of the currently active entry link, for history catch-up.
  getActiveClient (): HyperClient | undefined {
    return this.active ? this.active.getClient() : undefined
  }

  getActiveLinkName (): string | undefined {
    return this.active ? this.active.name : undefined
  }

  // Raises a realm's high-water mark to at least position (never lowers it). Called when a
  // projection finishes catch-up, so a live record older than what catch-up already applied cannot
  // pass an unset guard and regress the projection's position.
  seedHighWater (realmName: string, position: string | null): void {
    if (!position) return
    const current = this.highWater.get(realmName)
    if (current === undefined || position > current) {
      this.highWater.set(realmName, position)
    }
  }

  private reelect (): void {
    if (this.active && this.active.isConnected()) return
    this.active = this.links.find(link => link.isConnected()) || null
  }

  private deliver (link: WireLink, body: BODY_SEGMENT_COMMITTED): void {
    if (link !== this.active) return
    const guarded = this.guard(body)
    if (!guarded) return
    for (const listener of this.listeners) {
      listener(guarded)
    }
  }

  private guard (body: BODY_SEGMENT_COMMITTED): BODY_SEGMENT_COMMITTED | null {
    if (body.events.length === 0) {
      // an empty ack only advances watermarks; one older than what was already forwarded would
      // move a projection's position backwards through ProjectionListener's empty-batch branch
      if (body.segment <= this.lastSegment) return null
      this.lastSegment = body.segment
      return body
    }
    const kept = body.events.filter(record => {
      const seen = this.highWater.get(record.realm)
      if (seen !== undefined && record.eventId <= seen) {
        this.warn(`kvnode: dropped out-of-order event ${record.eventId} for realm ${record.realm} (already forwarded up to ${seen})`)
        return false
      }
      this.highWater.set(record.realm, record.eventId)
      return true
    })
    // every record was stale: forwarding the now-empty batch would still advance watermarks
    // to body.segment, so drop the whole delivery
    if (kept.length === 0) return null
    if (body.segment > this.lastSegment) this.lastSegment = body.segment
    return { ...body, events: kept }
  }
}
