## 1. Types and Constants

- [x] 1.1 Add `STORAGE_NODE_CONNECTED = 'STORAGE_NODE_CONNECTED'` to `Event` enum in `lib/masterfree/hyper.h.ts`
- [x] 1.2 Add `BODY_STORAGE_NODE_CONNECTED = { nodeId: string }` type to `hyper.h.ts` (no `shards`/`lastEventId` — shard coverage is expressed via which per-shard procedures a node registers, not via this announcement)
- [x] 1.3 Add a helper `Event.historyFetchTopic(shardTag: number) => 'fox.storage.history.fetch.' + shardTag` (or equivalent) in `hyper.h.ts`, mirroring the existing `beginAdvanceSegmentTopic`/`keepAdvanceHistoryTopic` naming pattern
- [x] 1.4 Add `HistoryFetchRequest = { realm: string, afterEventId: string | null }` type to `hyper.h.ts`
- [x] 1.5 Add `HistoryFetchProgress = { events: HistoryEvent[], lastEventId: string }` type to `hyper.h.ts`
- [x] 1.6 Add `HistoryEvent = { eventId: string, shardTag: number, uri: string[], data: any, opt: any }` type to `hyper.h.ts`

## 2. Storage Node: Per-Shard History Fetch RPC

- [x] 2.1 In `EventStorageTask` constructor, for each `shard` in `shardConfig.shards`, register `Event.historyFetchTopic(shard)` on `this.api` — handler signature `async ({ realm, afterEventId }, opt)`, closing over `shard`. Also register the same procedure on the `client` passed into `listenEntry(client, gateId)` (once per connected entry) — `pipe()` does not bridge RPC registrations across separate `Router`/realm objects, so a genuinely remote entry can only reach a registration made through its own session (see design.md D2 "Registered where, exactly")
- [x] 2.2 In the handler: check if `event_history_<realm>` exists (via the task's own `realms` set); if not, return `{ done: true }` immediately
- [x] 2.3 **Implemented differently than drafted, for correctness:** rather than guessing segment boundaries from `event_id` string-prefix structure (unreliable — segment IDs are opaque strings of unknown/variable length, confirmed via `test/63.storage.ts`'s `'res_seg1'` fixture, not the fixed-width encoding an earlier draft assumed), the handler queries `segment_registry_<realm>` (new `listResolvedSegmentIdsForShard` in `lib/sqlite/segment_registry.ts`) for this shard's resolved segment IDs, ordered ASC, and flushes a batch whenever the next `event_history` row's `msg_id` no longer starts with the current segment's ID
- [x] 2.4 On each segment boundary: call `opt.progress({ events: batch, lastEventId: batch[batch.length-1].eventId })` and reset the batch
- [x] 2.5 After iteration: flush any remaining batch via `opt.progress`, then return `{ done: true }`
- [x] 2.6 Map each `event_history` row to `HistoryEvent` shape: `{ eventId: row.id, shardTag: row.shard, uri: row.uri, data: unSerializeData(row.body), opt: row.opt }` (`unSerializeData` reverses the `p64` base64 wrapping applied when the event was originally saved)
- [ ] 2.7 Registration-cleanup-on-disconnect was confirmed generically during design review (`lib/session.ts:105-110`, cited in design.md) but is not covered by a dedicated disconnect test here — `test/68.net_subscription.ts`'s 7.9 test covers connect/reachability, not teardown

## 3. Storage Node: Connection Announcement

- [x] 3.1 In `EventStorageTask.listenEntry(client, gateId)`: set up `await this.api.pipe(client, Event.STORAGE_NODE_CONNECTED)` (mirrors the existing `this.api.pipe(client, Event.TRIM_ADVANCE_SEGMENT + '.' + gateId)` pattern already in this function)
- [x] 3.2 Then publish `STORAGE_NODE_CONNECTED` on `this.api` with `{ nodeId }`, **passing `{ exclude_me: false }` explicitly** — the pipe subscription set up in 3.1 shares the same session as this publish, and `HyperClient.publish` defaults `exclude_me` to `true`, which would otherwise silently suppress delivery to the pipe's own subscription (found via the 7.9 cross-router test failing until this was added; matches the existing `TRIM_ADVANCE_SEGMENT` publish two lines above, which already passes this option). Do **not** call `client.publish(...)` directly and do **not** rely on entry/storage sharing the same realm object.
- [x] 3.3 Add `nodeId: string` to `EventStorageTask` constructor (passed from `router.getId()` / `conf_node_id` at call sites)

## 4. Entry Node: NetSubStatusFactory (connection tracking only)

- [x] 4.1 Create `lib/masterfree/net_sub.ts` with `NetSubStatusFactory` class
- [x] 4.2 `NetSubStatusFactory` constructor takes `sysApi: HyperClient`; subscribes to `STORAGE_NODE_CONNECTED`
- [x] 4.3 On `STORAGE_NODE_CONNECTED`: record that at least one node has connected (a simple boolean)
- [x] 4.4 Add `hasStorageNodes(): boolean` — returns `true` if any node has ever announced
- [x] 4.5 Add `NetSubStatusFactory` instance to `NetEngineMill`; construct it in `NetEngineMill` constructor with `this.sysApi`

## 5. Entry Node: SharedSegmentBuffer

- [x] 5.1 Add `SharedSegmentBuffer` class to `lib/masterfree/net_sub.ts`
- [x] 5.2 Fields: `events: HistoryEvent[]`, `eventIds: Set<string>` (dedup index), `loading: boolean`, `done: boolean`, `waiters: Array<() => void>`
- [x] 5.3 Add `ensureLoading(sysApi, realm, afterEventId)`: if already loading/done, no-op; otherwise set `loading = true` and call `sysApi.callrpc(Event.historyFetchTopic(shardTag), { realm, afterEventId }, { progress })` concurrently for every `shardTag` in `0..TOTAL_SHARDS_COUNT-1`; a call rejecting with `ERROR_NO_SUCH_PROCEDURE` (checked via `RealmError`/`errorCodes`) is treated as that shard contributing zero events
- [x] 5.4 In progress callback (`appendEvents`): duplicate `event_id`s are discarded silently; new events are inserted maintaining `event_id ASC` order, with an error logged if out-of-order; waiters notified
- [x] 5.5 When all `TOTAL_SHARDS_COUNT` calls have settled: `done = true`; waiters notified
- [x] 5.6 Add `drainUntil(afterEventId, uri, cbRow)`: iterates `this.events` from the cursor position, applies an exact-match URI filter (`restoreUri` equality, matching the same limitation `DbEngine.getHistoryAfter` already has), calls `cbRow({qid, uri, data})`; loops awaiting new waiters until `done`
- [x] 5.7 Add `realmBuffers: Map<string, SharedSegmentBuffer>` to `NetEngineMill`; add `getOrCreateBuffer(realm): SharedSegmentBuffer`

## 6. NetEngine: getHistoryAfter Implementation

- [x] 6.1 In `NetEngine.getHistoryAfter(after, uri, cbRow)`: call `this.netEngineMill.getOrCreateBuffer(this.getRealmName())`
- [x] 6.2 Call `buffer.ensureLoading(this.netEngineMill.getSysApi(), realm, after)`
- [x] 6.3 Call `buffer.drainUntil(after, uri, cbRow)` and return the resulting promise
- [x] 6.4 `supportsRetainedEventSync` is defined via `Object.defineProperty` in the `NetEngine` constructor (a plain class accessor can't override `BaseEngine`'s field declaration — TS2611) returning `this.netEngineMill.getNetSubStatusFactory().hasStorageNodes()`

## 7. Tests

All in `test/68.net_subscription.ts` unless noted.

- [x] 7.1 Unit test: RPC returns only the registered shard's events, `event_id ASC`, excluding other shards
- [x] 7.2 Unit test: `afterEventId` cursor returns only events after cursor
- [x] 7.3 Unit test: unknown realm returns `{ done: true }` immediately
- [x] 7.4 Unit test: `NetSubStatusFactory` absorbs `STORAGE_NODE_CONNECTED`
- [x] 7.5 Unit test: `SharedSegmentBuffer` merges two shards' concurrent calls in ASC order (via a fake `sysApi`)
- [x] 7.6 Integration test: `netApi.subscribe(topic, cb, { after })` on a single-router entry+storage setup replays remaining committed history in order
- [x] 7.7 Integration test: two concurrent `NetEngine.getHistoryAfter` calls on the same realm trigger `handleHistoryFetch` exactly once (shared buffer)
- [x] 7.8 Integration test: two separate `EventStorageTask` instances both configured with shard `0`, sharing one realm; a fetch call returns the event exactly once
- [x] 7.9 Integration test: genuinely separate storage/entry `Router`s bridged only via `listenEntry`; asserts `STORAGE_NODE_CONNECTED` is received and the per-shard RPC is callable from the entry's own `sysApi` — this test is what caught the `exclude_me` bug in task 3.2
- [x] 7.10 Regression test: covered at two levels — `SharedSegmentBuffer.drainUntil` resolves with zero events when every shard call rejects `ERROR_NO_SUCH_PROCEDURE`, and `NetEngine.getHistoryAfter` resolves (no hang) on a realm with no storage nodes at all
- [x] 7.11 Unit test: a shard's progress callback re-delivering the same `event_id` (simulating retry overlap) is deduplicated, not double-appended

## 8. Build and Final Checks

- [x] 8.1 Run `tsc --noEmit` — no TypeScript errors
- [x] 8.2 Run `npm test` (lint + build + `npm run-script mocha-node-test`) — full suite passes, 288 passing
