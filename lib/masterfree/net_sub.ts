import { restoreUri } from '../topic_pattern'
import { errorCodes, RealmError } from '../realm_error'
import { HyperClient } from '../hyper/client'
import { Event, HistoryEvent, HistoryFetchRequest, HistoryFetchProgress, TOTAL_SHARDS_COUNT } from './hyper.h'

// Bounded FIFO de-dup window for live-tail dispatch (see openspec/changes/net-subscription D8).
// A shard replicated across N storage nodes each independently commits and broadcasts the same
// event, so an entry can see up to N copies of one eventId. Unlike SharedSegmentBuffer (bounded
// by realm history size and scoped to one historical fetch), this window must survive for the
// life of the process, so it evicts the oldest entry once capacity is exceeded rather than
// growing unbounded.
export class SeenEventWindow {
  private seen: Set<string> = new Set()
  private order: string[] = []

  constructor (private capacity: number = 5000) {}

  // Returns true and records the id if it hasn't been seen; returns false if it's a duplicate.
  addIfNew (eventId: string): boolean {
    if (this.seen.has(eventId)) {
      return false
    }
    this.seen.add(eventId)
    this.order.push(eventId)
    if (this.order.length > this.capacity) {
      const oldest = this.order.shift()!
      this.seen.delete(oldest)
    }
    return true
  }
}

export class NetSubStatusFactory {
  private connected: boolean = false

  constructor (sysApi: HyperClient) {
    sysApi.subscribe(Event.STORAGE_NODE_CONNECTED, () => {
      this.connected = true
    })
  }

  hasStorageNodes (): boolean {
    return this.connected
  }
}

export class SharedSegmentBuffer {
  private events: HistoryEvent[] = []
  private eventIds: Set<string> = new Set()
  private loading: boolean = false
  private done: boolean = false
  private waiters: Array<() => void> = []

  isDone (): boolean {
    return this.done
  }

  ensureLoading (sysApi: HyperClient, realm: string, afterEventId: string | null): void {
    if (this.loading || this.done) {
      return
    }
    this.loading = true

    let remaining = TOTAL_SHARDS_COUNT
    const settleOne = () => {
      remaining--
      if (remaining === 0) {
        this.done = true
        this.notifyAll()
      }
    }

    for (let shardTag = 0; shardTag < TOTAL_SHARDS_COUNT; shardTag++) {
      const req: HistoryFetchRequest = { realm, afterEventId }
      sysApi.callrpc(Event.historyFetchTopic(shardTag), req, {
        progress: (progress: HistoryFetchProgress) => {
          this.appendEvents(progress.events)
        }
      }).then(() => {
        settleOne()
      }).catch((err: any) => {
        if (err instanceof RealmError && err.code === errorCodes.ERROR_NO_SUCH_PROCEDURE) {
          settleOne()
          return
        }
        console.error('history fetch failed for shard', shardTag, err)
        settleOne()
      })
    }
  }

  private appendEvents (events: HistoryEvent[]): void {
    for (const event of events) {
      if (this.eventIds.has(event.eventId)) {
        continue
      }
      this.eventIds.add(event.eventId)

      let idx = this.events.length
      while (idx > 0 && this.events[idx - 1].eventId > event.eventId) {
        idx--
      }
      if (idx < this.events.length) {
        console.error('out-of-order history event delivery', event.eventId)
      }
      this.events.splice(idx, 0, event)
    }
    this.notifyAll()
  }

  private notifyAll (): void {
    const waiters = this.waiters
    this.waiters = []
    for (const waiter of waiters) {
      waiter()
    }
  }

  async drainUntil (afterEventId: string | null, uri: string[], cbRow: (cmd: { qid: string, uri: string[], data: any }) => void): Promise<void> {
    const wantUri = restoreUri(uri)
    let cursor = afterEventId

    for (;;) {
      let idx = 0
      if (cursor !== null) {
        idx = this.events.findIndex(event => event.eventId > cursor!)
        if (idx === -1) {
          idx = this.events.length
        }
      }
      for (; idx < this.events.length; idx++) {
        const event = this.events[idx]
        if (restoreUri(event.uri) === wantUri) {
          cbRow({ qid: event.eventId, uri: event.uri, data: event.data })
        }
        cursor = event.eventId
      }
      if (this.done) {
        return
      }
      await new Promise<void>(resolve => this.waiters.push(resolve))
    }
  }
}
