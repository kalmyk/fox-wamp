## 1. Types and Constants

- [ ] 1.1 Add `STORAGE_NODE_CONNECTED = 'STORAGE_NODE_CONNECTED'` to `Event` enum in `lib/masterfree/hyper.h.ts`
- [ ] 1.2 Add `BODY_STORAGE_NODE_CONNECTED = { nodeId: string }` type to `hyper.h.ts` (no `shards`/`lastEventId` — shard coverage is expressed via which per-shard procedures a node registers, not via this announcement)
- [ ] 1.3 Add a helper `Event.historyFetchTopic(shardTag: number) => 'fox.storage.history.fetch.' + shardTag` (or equivalent) in `hyper.h.ts`, mirroring the existing `beginAdvanceSegmentTopic`/`keepAdvanceHistoryTopic` naming pattern
- [ ] 1.4 Add `HistoryFetchRequest = { realm: string, afterEventId: string | null }` type to `hyper.h.ts`
- [ ] 1.5 Add `HistoryFetchProgress = { events: HistoryEvent[], lastEventId: string }` type to `hyper.h.ts`
- [ ] 1.6 Add `HistoryEvent = { eventId: string, shardTag: number, uri: string[], data: any, opt: any }` type to `hyper.h.ts`

## 2. Storage Node: Per-Shard History Fetch RPC

- [ ] 2.1 In `EventStorageTask` constructor, for each `shard` in `shardConfig.shards`, register `Event.historyFetchTopic(shard)` on `this.api` — handler signature `async ({ realm, afterEventId }, opt)`, closing over `shard`
- [ ] 2.2 In the handler: check if `event_history_<realm>` exists; if not, return `{ done: true }` immediately
- [ ] 2.3 In the handler: call `getEventHistory(db, realm, { fromId: afterEventId ?? undefined })` with a row callback that filters to `event.shard === shard` (the closed-over shard tag) and accumulates matching events per segment boundary (detect segment change when `event_id` prefix changes)
- [ ] 2.4 On each segment boundary: call `opt.progress({ events: batch, lastEventId: batch[batch.length-1].eventId })` and reset the batch
- [ ] 2.5 After iteration: flush any remaining batch via `opt.progress`, then return `{ done: true }`
- [ ] 2.6 Map each `event_history` row to `HistoryEvent` shape: `{ eventId: row.id, shardTag: row.shard, uri: row.uri, data: row.body, opt: row.opt }`
- [ ] 2.7 Confirm session/registration cleanup (existing `cmdUnRegRpc`/session-teardown machinery) correctly removes a storage node's per-shard registrations when it disconnects, so `doCall` doesn't route to a dead registrant — this should be "already true" via existing generic registration lifecycle, not new code; verify with a test (7.9) rather than assume

## 3. Storage Node: Connection Announcement

- [ ] 3.1 In `EventStorageTask.listenEntry(client, gateId)`: set up `await this.api.pipe(client, Event.STORAGE_NODE_CONNECTED)` (mirrors the existing `this.api.pipe(client, Event.TRIM_ADVANCE_SEGMENT + '.' + gateId)` pattern already in this function)
- [ ] 3.2 Then publish `STORAGE_NODE_CONNECTED` on `this.api` with `{ nodeId }` — the pipe set up in 3.1 forwards it to the connecting entry. Do **not** call `client.publish(...)` directly and do **not** rely on entry/storage sharing the same realm object (existing tests happen to share one `sysRealm`, which would mask a missing bridge — see task 7.8).
- [ ] 3.3 Add `nodeId: string` to `EventStorageTask` constructor (pass from `router.getId()` at the call site or as explicit param)

## 4. Entry Node: NetSubStatusFactory (connection tracking only)

- [ ] 4.1 Create `lib/masterfree/net_sub.ts` with `NetSubStatusFactory` class
- [ ] 4.2 `NetSubStatusFactory` constructor takes `sysApi: HyperClient`; subscribes to `STORAGE_NODE_CONNECTED`
- [ ] 4.3 On `STORAGE_NODE_CONNECTED`: record that at least one node has connected (a simple boolean or counter — no per-shard or per-node map)
- [ ] 4.4 Add `hasStorageNodes(): boolean` — returns `true` if any node has ever announced
- [ ] 4.5 Add `NetSubStatusFactory` instance to `NetEngineMill`; construct it in `NetEngineMill` constructor with `this.sysApi`

## 5. Entry Node: SharedSegmentBuffer

- [ ] 5.1 Add `SharedSegmentBuffer` class to `lib/masterfree/net_sub.ts`
- [ ] 5.2 Fields: `events: HistoryEvent[]`, `cursor: string | null`, `loading: boolean`, `done: boolean`, `waiters: Array<() => void>`
- [ ] 5.3 Add `ensureLoading(sysApi: HyperClient, realm: string, afterEventId: string | null)`: if already loading/done, no-op; otherwise set `loading = true` and call `sysApi.callrpc(Event.historyFetchTopic(shardTag), { realm, afterEventId }, { progress: ... })` concurrently for every `shardTag` in `0..TOTAL_SHARDS_COUNT-1`; a call rejecting with `ERROR_NO_SUCH_PROCEDURE` SHALL be treated as that shard immediately contributing zero events (not a failure of the overall load)
- [ ] 5.4 In progress callback: if `event_id` already exists in `this.events`, discard the duplicate silently (expected on retry after a mid-stream failure, not an error); otherwise insert into `this.events` maintaining `event_id ASC` order, and if it arrives out of order (lower than the current max) log an error; update `cursor`; notify all waiters
- [ ] 5.5 When all `TOTAL_SHARDS_COUNT` calls have settled (success or `ERROR_NO_SUCH_PROCEDURE`): set `done = true`; notify all waiters. Since this count is fixed and never zero, this always resolves — no empty-list special case is needed (unlike the original per-node-client-list design)
- [ ] 5.6 Add `drainUntil(afterEventId: string | null, uri: string[], cbRow: (e: HistoryEvent) => void): Promise<void>`: iterate `this.events` from position after `afterEventId`, apply URI filter, call `cbRow`; if not `done` and no more events, register as waiter and await; repeat until `done`
- [ ] 5.7 Add `realmBuffers: Map<string, SharedSegmentBuffer>` to `NetEngineMill`; add `getOrCreateBuffer(realm: string): SharedSegmentBuffer`

## 6. NetEngine: getHistoryAfter Implementation

- [ ] 6.1 In `NetEngine.getHistoryAfter(after, uri, cbRow)`: call `this.netEngineMill.getOrCreateBuffer(this.getRealmName())`
- [ ] 6.2 Call `buffer.ensureLoading(this.netEngineMill.sysApi, realm, after)`
- [ ] 6.3 Call `buffer.drainUntil(after, uri, cbRow)` and return the resulting promise
- [ ] 6.4 In `NetEngine` getter/setter: expose `supportsRetainedEventSync` as a dynamic property that returns `this.netEngineMill.netSubStatusFactory.hasStorageNodes()`

## 7. Tests

- [ ] 7.1 Unit test: `fox.storage.history.fetch.<shardTag>` RPC returns only that shard's events in `event_id ASC` order via progress calls (in-process, single storage node, one realm, events on multiple shards — assert cross-shard events are excluded)
- [ ] 7.2 Unit test: `fox.storage.history.fetch.<shardTag>` with `afterEventId` returns only events after cursor
- [ ] 7.3 Unit test: `fox.storage.history.fetch.<shardTag>` with unknown realm returns `{ done: true }` immediately
- [ ] 7.4 Unit test: `NetSubStatusFactory` absorbs `STORAGE_NODE_CONNECTED` and `hasStorageNodes()` returns `true`
- [ ] 7.5 Unit test: `SharedSegmentBuffer` merges events from two different shards' concurrent calls in `event_id ASC` order
- [ ] 7.6 Integration test: publish events on distributed realm, subscriber connects with `after=<first event id>`, receives remaining events in order before live events
- [ ] 7.7 Integration test: two `ActorNetSub` on same realm share one buffer (assert each shard's RPC called only once total, not once per subscriber)
- [ ] 7.8 Integration test: two separate `EventStorageTask` instances both configured with shard `0` (replication) both register `fox.storage.history.fetch.0`; a fetch for that shard is served by exactly one of them and the buffer contains each event exactly once — no manual node tracking involved
- [ ] 7.9 Integration test: the "entry" client is built on a genuinely separate `BaseRealm`/`Router` from the storage task's own `sysRealm` (unlike the historically-used same-realm `sysRealm.buildApi()` shortcut, which would mask a missing `pipe()` bridge) — assert the entry-side subscriber actually receives `STORAGE_NODE_CONNECTED`, and that a call to a shard procedure registered on the separate storage realm is reachable from the entry's realm through whatever routing/piping is set up
- [ ] 7.10 Regression test: a plain (non-`retained`/`retainedState`) `SUBSCRIBE` with `after` set, on a distributed realm with zero storage nodes connected, resolves (does not hang) and delivers no history — exercises the fixed `TOTAL_SHARDS_COUNT`-call path where every call fails with `ERROR_NO_SUCH_PROCEDURE`
- [ ] 7.11 Unit test: a shard's RPC call fails mid-stream (simulated registrant error after partial progress); a retry of that same shard's call lands on a different (or the same, recovered) registrant and the buffer ends up with each event exactly once (dedup on the overlap, no out-of-order error logged for the expected re-delivery)

## 8. Build and Final Checks

- [ ] 8.1 Run `tsc --noEmit` — no TypeScript errors
- [ ] 8.2 Run `npm test` — full suite passes
