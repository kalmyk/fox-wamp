import * as sqlite from 'sqlite'
import { getEventHistory } from './history'
import { latestRealmEventId } from './storage_registry'

// One committed event as ProjectionListener's activation replay consumes it. `body` is in the
// stored (makeDataSerializable) form, i.e. what event_history_<realm>.msg_body holds, because
// KvProjection.applyEvent unwraps it with unSerializeData.
export type RealmHistoryRow = {
  id: string
  shard: number
  uri: string[]
  body: any
  opt: any
}

// Where a projection's activation catch-up reads a realm's committed history from. A projection
// that shares a db with the event history (OneDbRouter, ndb.ts) reads it locally; a standalone
// KV-node has no local event_history_<realm> rows and pulls them from storage nodes instead.
export interface RealmHistorySource {
  // Highest eventId the source can replay for the realm — the activation target — or null when
  // there is nothing to replay. afterEventId is the projection's current position; a source that
  // fetches over the network may use it to avoid re-fetching what is already applied.
  latestEventId (realmName: string, afterEventId?: string | null): Promise<string | null>

  // Calls cb, one row at a time and in ascending eventId order, for every event with
  // fromId < eventId <= toId (either bound optional).
  fetchSince (
    realmName: string,
    range: { fromId?: string, toId?: string },
    cb: (row: RealmHistoryRow) => Promise<void>
  ): Promise<void>
}

// Today's behavior: history lives in the same db as the projections.
export class LocalDbHistorySource implements RealmHistorySource {
  constructor (private db: sqlite.Database) {}

  latestEventId (realmName: string): Promise<string | null> {
    return latestRealmEventId(this.db, realmName)
  }

  async fetchSince (realmName: string, range: { fromId?: string, toId?: string }, cb: (row: RealmHistoryRow) => Promise<void>): Promise<void> {
    await getEventHistory(this.db, realmName, range, cb)
  }
}
