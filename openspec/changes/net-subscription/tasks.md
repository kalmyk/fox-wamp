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

## 8. Types: DISPATCH_EVENT (live dispatch)

- [x] 8.1 Add `DISPATCH_EVENT = 'dispatch-event'` to the `Event` enum in `lib/masterfree/hyper.h.ts`
- [x] 8.2 Add `DispatchEventRecord = { eventId: string, uri: string[], data: any, opt: any, sid: string }` type
- [x] 8.3 Add `BODY_DISPATCH_EVENT = { realm: string, events: DispatchEventRecord[] }` type
- [x] 8.4 Remove the ad hoc `'dispatchEvent'` string subscription and its `opt.headers`-based single-event handling in `NetEngineMill` (dead code, never published to by anything) in favor of the typed `Event.DISPATCH_EVENT`/`BODY_DISPATCH_EVENT` from 8.1-8.3

## 9. Storage Node: Publish DISPATCH_EVENT on Commit

- [x] 9.1 In `EventStorageTask`'s existing `Event.ADVANCE_SEGMENT_RESOLVED` subscribe handler (`storage.ts`), after `commit_segment(...)` resolves (same point `this.dbFactory.emit(SEGMENT_COMMITTED, result)` already fires), group `result.events` (`CommittedSegmentRecord[]`) by `realm` — implemented as `dispatchCommittedEvents(events)`, called right after the `SEGMENT_COMMITTED` emit
- [x] 9.2 For each realm group with at least one event, publish `Event.DISPATCH_EVENT` on `this.api` with `{ realm, events: [...] }` (`{ exclude_me: false }`); a realm group is only produced when `result.events` is non-empty, so the existing "no-data" case (this node doesn't own the shard's buffer) naturally publishes nothing
- [x] 9.3 In `EventStorageTask.listenEntry(client, gateId)`, pipe `Event.DISPATCH_EVENT` to the connecting entry: `await this.api.pipe(client, Event.DISPATCH_EVENT, {exclude_me: false})` — alongside the existing `Event.ADVANCE_SEGMENT_RESOLVED` pipe added for the ack-path fix

## 10. Entry Node: Live Dispatch Fan-out and Dedup

- [x] 10.1 Add a small bounded dedup helper to `lib/masterfree/net_sub.ts` — `SeenEventWindow`, wrapping a `Set<string>` plus an insertion-order array, capped at a fixed capacity (5000), evicting the oldest entry when exceeded
- [x] 10.2 In `NetEngineMill`, replace the `'dispatchEvent'` subscription with `this.sysApi.subscribe(Event.DISPATCH_EVENT, (body: BODY_DISPATCH_EVENT) => { ... })`
- [x] 10.3 In the handler: resolve `const realm = this.router.findRealm(body.realm)`; if not found, return (silently — not every entry hosts every realm)
- [x] 10.4 For each `DispatchEventRecord` in `body.events`: skip if `eventId` already in the dedup window (10.1); otherwise record it and call `realm.getEngine().disperseToSubs({ qid: eventId, uri, data: unSerializeData(data), opt, sid })`
- [x] 10.5 Renamed the old `dispatchEvent(eventData: any)` method to `dispatchLiveEvents(body: BODY_DISPATCH_EVENT)`, folding in 10.2-10.4; the `opt.headers`-smuggling call site is gone

## 11. Tests (Live Dispatch)

New tests added to `test/68.net_subscription.ts` (kept in the same file — it stayed a reasonable size).

- [x] 11.1 Unit test: `commit_segment` with events triggers exactly one `Event.DISPATCH_EVENT` per distinct realm in the committed batch
- [x] 11.2 Unit test: `commit_segment` with zero events (no-data case, a second `EventStorageTask` not owning the shard) publishes no `Event.DISPATCH_EVENT` — combined into the same test as 11.1
- [x] 11.3 Integration test: a plain `session.subscribe(topic, cb)` (no `after`) on a distributed (`NetEngine`) realm receives an event published after the subscription was established — the regression test for the original bug
- [x] 11.4 Integration test: two storage nodes configured with an overlapping shard both independently commit the same segment; the entry's live subscriber receives the event exactly once (dedup verified)
- [x] 11.5 **Implemented differently than drafted:** rather than an artificial in-flight-catch-up race (found during implementation to also double-deliver via the *pre-existing, unrelated* local-engine-shared gap noted in design.md's new Risk — historical replay and live dispatch have no cross-source dedup, not something specific to this change), the test covers the realistic and well-defined case instead: after an `after`-based catch-up finds nothing left to replay (`traceStarted = true` with an empty replay), a **subsequent** live commit is still delivered — this is still a real regression test, since before this change nothing would ever have arrived at all once `traceStarted` was set
- [x] 11.6 Integration test: `Event.DISPATCH_EVENT` for a realm with no local sessions/subscribers does not throw and is a no-op
- [x] 11.7 Unit test: dedup window evicts oldest entries once its capacity is exceeded (does not grow unbounded)

## 12. Build and Final Checks

- [x] 12.0 (Pre-existing, before this addition) `tsc --noEmit` and `npm test` passed with 288 tests for the historical-catch-up half of this change
- [x] 12.1 Run `tsc --noEmit` (via `npm run build`) — no TypeScript errors
- [x] 12.2 Run `npm test` (lint + build + `npm run-script mocha-node-test`) — full suite passes, 305 passing

## 13. Revision: Consolidate DISPATCH_EVENT into SEGMENT_COMMITTED

Sections 8-10 above introduced a brand-new `Event.DISPATCH_EVENT` broadcast, published in *addition* to `SEGMENT_COMMITTED` (which storage already `dbFactory.emit()`s locally, in-process, for `ProjectionListener`) — two events firing at the same point, carrying near-identical data. Once `SEGMENT_COMMITTED` was recognized as just needing to become pipeable, the separate `DISPATCH_EVENT` type was redundant. This section replaces it.

- [x] 13.1 In `lib/masterfree/hyper.h.ts`: remove `Event.DISPATCH_EVENT`, `BODY_DISPATCH_EVENT`, `DispatchEventRecord`. Add `Event.SEGMENT_COMMITTED = 'segment-committed'` to the `Event` enum; add `CommittedSegmentRecord` and `BODY_SEGMENT_COMMITTED = BODY_ADVANCE_SEGMENT_RESOLVED & { events: CommittedSegmentRecord[] }` as the canonical wire types
- [x] 13.2 In `lib/masterfree/segment_types.ts`: turn it into a thin re-export shim — `SEGMENT_COMMITTED` is now literally `Event.SEGMENT_COMMITTED`; `CommittedSegmentRecord`/`CommittedSegmentEvent` (alias for `BODY_SEGMENT_COMMITTED`) and `SegmentCommittedSource` (the local-`EventEmitter`-facing interface) are re-exported from/defined against `hyper.h.ts`, preserving the existing import surface for `dbfactory.ts`/`storage.ts`/`projection_listener.ts`/tests
- [x] 13.3 In `storage.ts`'s `Event.ADVANCE_SEGMENT_RESOLVED` handler: remove `dispatchCommittedEvents(events)` and its by-realm grouping entirely; when `result.events.length > 0`, publish the same `result` (already shaped as `BODY_SEGMENT_COMMITTED`) via `this.api.publish(Event.SEGMENT_COMMITTED, result, { exclude_me: false })`, right next to the pre-existing `dbFactory.emit(SEGMENT_COMMITTED, result)`
- [x] 13.4 In `storage.ts`'s `listenEntry`: replace the `Event.DISPATCH_EVENT` pipe with `await this.api.pipe(client, Event.SEGMENT_COMMITTED, {exclude_me: false})`
- [x] 13.5 In `netengine.ts`: subscribe to `Event.SEGMENT_COMMITTED` instead of `Event.DISPATCH_EVENT`; `dispatchLiveEvents(body: BODY_SEGMENT_COMMITTED)` now resolves `this.router.findRealm(event.realm)` **per event** inside the loop (rather than once for the whole body), since a single `SEGMENT_COMMITTED` batch is no longer guaranteed single-realm
- [x] 13.6 Updated `test/68.net_subscription.ts`'s "live dispatch" describe block: subscribes to `Event.SEGMENT_COMMITTED` instead of `Event.DISPATCH_EVENT`; test 11.1/11.2 asserts on `dispatches[0].events` records' individual `.realm` fields instead of a single `dispatches[0].realm`
- [x] 13.7 Updated `openspec/changes/net-subscription/{proposal,design,tasks}.md` and `specs/net-live-dispatch/spec.md` to describe `Event.SEGMENT_COMMITTED` as the live-dispatch wire event throughout, in place of `Event.DISPATCH_EVENT`
- [x] 13.8 `tsc --noEmit` clean; `npm test` — 305 passing, unchanged count (this is a rename/consolidation, not new coverage)
