import { makeDataSerializable } from '../realm'
import { errorCodes, RealmError } from '../realm_error'
import { RealmHistorySource, RealmHistoryRow } from '../sqlite/realm_history_source'
import { Event, HistoryEvent, HistoryFetchRequest, HistoryFetchProgress, TOTAL_SHARDS_COUNT } from './hyper.h'

// A shard nobody registered the history RPC for. An in-process caller sees a RealmError carrying
// the code; a caller over a socket (the KV-node's real case) sees only the message text, because
// RemoteHyperClient rejects with the wire error's `data` and drops its code.
function isNoSuchProcedure (err: any): boolean {
  if (err instanceof RealmError && err.code === errorCodes.ERROR_NO_SUCH_PROCEDURE) return true
  const text = typeof err === 'string' ? err : err && err.message
  return typeof text === 'string' && text.startsWith('no callee registered for procedure')
}

// The one method of a HyperClient this source needs (also what tests fake).
export interface WireRpcCaller {
  callrpc (uri: string, data: any, opt?: any): Promise<any>
}

// RealmHistorySource for a standalone KV-node: a KV-node stores projections, not raw event
// history, so its activation catch-up pulls a realm's committed events from the storage nodes over
// the per-shard Event.historyFetchTopic RPC that every storage node registers on each entry it is
// attached to (the same RPC lib/masterfree/net_sub.ts's SharedSegmentBuffer uses on the entry side).
//
// Unlike SharedSegmentBuffer, a failing shard fails the whole fetch instead of being logged and
// skipped: a projection that went online after silently missing one shard's history would be
// wrong with no signal, whereas a failed activation is visible and retryable.
export class WireHistoryFetchSource implements RealmHistorySource {
  // latestEventId() fetches the whole snapshot to learn its highest eventId; fetchSince() then
  // replays that same snapshot instead of fetching a second time.
  private snapshots: Map<string, HistoryEvent[]> = new Map()

  // getCaller returns the currently active entry connection (see WireSegmentCommittedSource).
  constructor (private getCaller: () => WireRpcCaller | undefined, private shardCount: number = TOTAL_SHARDS_COUNT) {}

  async latestEventId (realmName: string, afterEventId: string | null = null): Promise<string | null> {
    const events = await this.fetchAll(realmName, afterEventId)
    this.snapshots.set(realmName, events)
    return events.length > 0 ? events[events.length - 1].eventId : null
  }

  async fetchSince (realmName: string, range: { fromId?: string, toId?: string }, cb: (row: RealmHistoryRow) => Promise<void>): Promise<void> {
    let events = this.snapshots.get(realmName)
    this.snapshots.delete(realmName)
    if (!events) {
      events = await this.fetchAll(realmName, range.fromId ?? null)
    }
    for (const event of events) {
      if (range.fromId && event.eventId <= range.fromId) continue
      if (range.toId && event.eventId > range.toId) break
      await cb({
        id: event.eventId,
        shard: event.shardTag,
        uri: event.uri,
        // history RPC results are unwrapped; applyEvent unwraps again, so hand it the stored form
        body: makeDataSerializable(event.data),
        opt: event.opt
      })
    }
  }

  private async fetchAll (realmName: string, afterEventId: string | null): Promise<HistoryEvent[]> {
    const caller = this.getCaller()
    if (!caller) {
      throw new Error('no entry connection available to fetch realm history from')
    }
    const byId = new Map<string, HistoryEvent>()
    const req: HistoryFetchRequest = { realm: realmName, afterEventId }
    const fetches: Promise<void>[] = []
    for (let shardTag = 0; shardTag < this.shardCount; shardTag++) {
      fetches.push(
        caller.callrpc(Event.historyFetchTopic(shardTag), req, {
          progress: (progress: HistoryFetchProgress) => {
            for (const event of progress.events) {
              byId.set(event.eventId, event)
            }
          }
        }).then(() => undefined, (err: any) => {
          // no storage node registered for this shard: nothing to fetch from it
          if (isNoSuchProcedure(err)) return
          throw err
        })
      )
    }
    await Promise.all(fetches)
    // each shard's stream is already sorted, but shards arrive interleaved
    return Array.from(byId.values()).sort((a, b) => a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0)
  }
}
