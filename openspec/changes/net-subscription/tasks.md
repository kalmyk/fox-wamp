## 1. Types and Constants

- [ ] 1.1 Add `STORAGE_NODE_CONNECTED = 'STORAGE_NODE_CONNECTED'` to `Event` enum in `lib/masterfree/hyper.h.ts`
- [ ] 1.2 Add `BODY_STORAGE_NODE_CONNECTED = { nodeId: string, shards: number[], lastEventId: string | null }` type to `hyper.h.ts`
- [ ] 1.3 Add `HISTORY_FETCH = 'fox.storage.history.fetch'` to a new `StorageEvent` namespace in `hyper.h.ts`
- [ ] 1.4 Add `HistoryFetchRequest = { realm: string, afterEventId: string | null }` type to `hyper.h.ts`
- [ ] 1.5 Add `HistoryFetchProgress = { events: HistoryEvent[], lastEventId: string }` type to `hyper.h.ts`
- [ ] 1.6 Add `HistoryEvent = { eventId: string, shardTag: number, uri: string[], data: any, opt: any }` type to `hyper.h.ts`

## 2. Storage Node: History Fetch RPC

- [ ] 2.1 In `EventStorageTask` constructor, register `fox.storage.history.fetch` on `this.api` — handler signature `async ({ realm, afterEventId }, opt)`
- [ ] 2.2 In the handler: check if `event_history_<realm>` exists; if not, return `{ done: true }` immediately
- [ ] 2.3 In the handler: call `getEventHistory(db, realm, { fromId: afterEventId ?? undefined })` with a row callback that accumulates events per segment boundary (detect segment change when `event_id` prefix changes)
- [ ] 2.4 On each segment boundary: call `opt.progress({ events: batch, lastEventId: batch[batch.length-1].eventId })` and reset the batch
- [ ] 2.5 After iteration: flush any remaining batch via `opt.progress`, then return `{ done: true }`
- [ ] 2.6 Map each `event_history` row to `HistoryEvent` shape: `{ eventId: row.id, shardTag: row.shard, uri: row.uri, data: row.body, opt: row.opt }`

## 3. Storage Node: Connection Announcement

- [ ] 3.1 In `EventStorageTask.listenEntry(client, gateId)`: call `scanMaxId(this.dbFactory.getMainDb())` to get `lastEventId`
- [ ] 3.2 Publish `STORAGE_NODE_CONNECTED` on `this.api` (sys realm) with `{ nodeId, shards: shardConfig.shards, lastEventId }` — `nodeId` from the router or a constructor parameter
- [ ] 3.3 Add `nodeId: string` to `EventStorageTask` constructor (pass from `router.getId()` at the call site or as explicit param)

## 4. Entry Node: NetSubStatusFactory

- [ ] 4.1 Create `lib/masterfree/net_sub.ts` with `NetSubStatusFactory` class
- [ ] 4.2 `NetSubStatusFactory` constructor takes `sysApi: HyperClient`; subscribes to `STORAGE_NODE_CONNECTED`
- [ ] 4.3 On `STORAGE_NODE_CONNECTED`: store `{ nodeId, storageClient (from announcement context), lastEventId }` per shard in `shardNodes: Map<number, NodeStatus[]>`
- [ ] 4.4 Add `getStorageClientsForRealm(realm: string): HyperClient[]` — returns unique clients across all shards (deduplicated by nodeId)
- [ ] 4.5 Add `hasStorageNodes(): boolean` — returns `true` if any node has announced
- [ ] 4.6 Add `NetSubStatusFactory` instance to `NetEngineMill`; construct it in `NetEngineMill` constructor with `this.sysApi`

## 5. Entry Node: SharedSegmentBuffer

- [ ] 5.1 Add `SharedSegmentBuffer` class to `lib/masterfree/net_sub.ts`
- [ ] 5.2 Fields: `events: HistoryEvent[]`, `cursor: string | null`, `loading: boolean`, `done: boolean`, `waiters: Array<() => void>`
- [ ] 5.3 Add `ensureLoading(clients: HyperClient[], realm: string, afterEventId: string | null)`: if already loading/done, no-op; otherwise set `loading = true` and call `fox.storage.history.fetch` on each client concurrently with `progress` callback
- [ ] 5.4 In progress callback: insert received events into `this.events` maintaining `event_id ASC` order; if any event arrives out of order log error; update `cursor`; notify all waiters
- [ ] 5.5 When all fetch calls complete: set `done = true`; notify all waiters
- [ ] 5.6 Add `drainUntil(afterEventId: string | null, uri: string[], cbRow: (e: HistoryEvent) => void): Promise<void>`: iterate `this.events` from position after `afterEventId`, apply URI filter, call `cbRow`; if not `done` and no more events, register as waiter and await; repeat until `done`
- [ ] 5.7 Add `realmBuffers: Map<string, SharedSegmentBuffer>` to `NetEngineMill`; add `getOrCreateBuffer(realm: string): SharedSegmentBuffer`

## 6. NetEngine: getHistoryAfter Implementation

- [ ] 6.1 In `NetEngine.getHistoryAfter(after, uri, cbRow)`: call `this.netEngineMill.getOrCreateBuffer(this.getRealmName())`
- [ ] 6.2 Call `buffer.ensureLoading(statusFactory.getStorageClientsForRealm(realm), realm, after)`
- [ ] 6.3 Call `buffer.drainUntil(after, uri, cbRow)` and return the resulting promise
- [ ] 6.4 In `NetEngine` getter/setter: expose `supportsRetainedEventSync` as a dynamic property that returns `this.netEngineMill.netSubStatusFactory.hasStorageNodes()`

## 7. Tests

- [ ] 7.1 Unit test: `fox.storage.history.fetch` RPC returns events in `event_id ASC` order via progress calls (in-process, single storage node, one realm)
- [ ] 7.2 Unit test: `fox.storage.history.fetch` with `afterEventId` returns only events after cursor
- [ ] 7.3 Unit test: `fox.storage.history.fetch` with unknown realm returns `{ done: true }` immediately
- [ ] 7.4 Unit test: `NetSubStatusFactory` absorbs `STORAGE_NODE_CONNECTED` and `hasStorageNodes()` returns `true`
- [ ] 7.5 Unit test: `SharedSegmentBuffer` with two concurrent node streams merges events in `event_id ASC` order
- [ ] 7.6 Integration test: publish events on distributed realm, subscriber connects with `after=<first event id>`, receives remaining events in order before live events
- [ ] 7.7 Integration test: two `ActorNetSub` on same realm share one buffer (assert `fox.storage.history.fetch` called only once)

## 8. Build and Final Checks

- [ ] 8.1 Run `tsc --noEmit` — no TypeScript errors
- [ ] 8.2 Run `npm test` — full suite passes
