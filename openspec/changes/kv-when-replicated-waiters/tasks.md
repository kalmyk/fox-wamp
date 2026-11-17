# Tasks

Groups 1–3 need no distributed ordering and can land now. Groups 4–7 start only after `live-dispatch-eventid-ordering` ships its reusable marker-then-fetch component (its tasks 5.1/5.5, design D3) and `session-lifecycle-events` ships voted `SESSION_JOIN` / `SESSION_LEAVE` (design D9).

## 1. Shared evaluation core

- [ ] 1.1 Add the pure evaluation core (design D4) in a new module under `lib/`: `evaluate(input, state)` for plain write, conditional request, `SESSION_JOIN` and `SESSION_LEAVE` inputs, returning `{ effects, resolutions }`, plus the state interface. No actor objects and no I/O. Verify with unit tests in a new `test/78.kv_eval_core.ts` covering applied / rejected / parked, mutex firing (two waiters, one wins), chained firing, waiter surviving key deletion, will application on session leave, and rejection of a request from a session that already left.
- [ ] 1.2 Implement derived effect ids in the core (`T + keyId(n)`, one counter per trigger event shared by wills and fired waiters). Verify with tests asserting `T < D1 < D2 < U` in string order, that a derived id never equals a real id, and that `getEventHistory`-style `msg_id > after` comparison on a derived `after` returns the following ids.
- [ ] 1.3 Add an in-memory state backend for the core (Maps: values, per-topic waiters ordered by request id, wills by session). Verify by running the 1.1/1.2 tests against it.

## 2. In-memory engine on the core

- [ ] 2.1 Rewrite `MemKeyValueStorage` (`lib/mono/memkv.ts`) to delegate to the core with the memory backend (D11). Remove `resWhen` from the value row and stop calling `confirm`/`rejectCmd` from inside storage. Verify the existing `test/55.kv.ts` and `test/20.realm.ts` KV cases still pass.
- [ ] 2.2 Add the realm-side local resolution dispatcher (`actorId -> actor`, actorId = the request's local eventId) in `lib/realm.ts`, delivering core resolutions as confirm/reject on the matching actor and dropping entries on session cleanup. Verify with a new test where two chained waiters are each confirmed against their own request (the bug where the triggering actor's `msg` was used), and with a parked waiter's session closing so it is dropped and never confirmed.
- [ ] 2.3 Route in-memory will application through the core's session-leave input instead of `runInboundEvent` from `eraseSessionData`. Verify `test/55.kv.ts` will scenarios pass, plus a new case where a will and a waiter on the same topic fire in the order the core defines.

## 3. Single-SQLite engine on the core

- [ ] 3.1 Add `kv_lock_<realm>` (request_event_id PK, topic, when, data, opt, entry_id, sid, actor_id; indexes on (topic, request_event_id) and (entry_id, sid)) to `createKvTables` in `lib/sqlite/sqlitekv.ts`, created with `IF NOT EXISTS`. Verify with a test that opens a fresh and an existing DB and finds the table and indexes.
- [ ] 3.2 Implement the SQLite state backend over `kv_<realm>`, `session_kv_<realm>` and `kv_lock_<realm>`, applying one evaluation step per `withWriteLock` transaction (D2). Verify by running the core tests from 1.1/1.2 against it, and with a test that a simulated failure mid-step leaves no partial write.
- [ ] 3.3 Switch `DbEngine` (`lib/mono/dbengine.ts`) to the core with the SQLite backend and the local dispatcher from 2.2. Remove `resWhen`, `parkActor` and `findNextWhenActor`. Clear `kv_lock_<realm>` on startup alongside the existing stale-will processing. Verify the existing SQLite KV tests pass, and add a test that `kv_lock_` is empty after restart.
- [ ] 3.4 Add a parity test that runs one scripted sequence of plain, `when`, `when+watch` and will publishes plus session closes against the in-memory engine and the single-SQLite engine, and asserts identical final values and identical ack/reject outcomes per publish (spec "Local engine parity"). Verify it passes.

## 4. Wire protocol and entry-side deferral

- [ ] 4.1 Add `KV_WHEN_RESOLVED` (per-entry topic `KV_WHEN_RESOLVED.<entryId>`), `KV_EFFECTS`, `KV_NODE_CONNECTED{nodeId, storage}` and the retryable no-owner error code with body types to `lib/masterfree/hyper.h.ts`. Verify `npm run compile` succeeds.
- [ ] 4.2 In `NetEngineMill` (`lib/masterfree/netengine.ts`), keep `opt.when` actors unconfirmed at `advance_segment_resolved` and move them into a `pendingWhen` map keyed by `advanceOwner + advanceId`. Subscribe to `KV_WHEN_RESOLVED.<ownId>` and confirm or reject on the first resolution, ignoring duplicates and unknown ids (D8). Verify with a test using synthetic resolution messages: one ack for N duplicates, reject maps to `ERROR_INVALID_PAYLOAD`, and an unknown actor id is a no-op.
- [ ] 4.3 Publish `KV_NODE_CONNECTED` with the node's own storage patterns from the KV node's `HyperNetEntryLink` on every open. On the entry, keep a connected-owner table (add on announce, remove when that sys-realm session closes) and reject a `when` publish before `saveHistory` with the retryable no-owner error when no connected node owns its `realm:topic` (design D12). Verify with tests: no owner rejects without reaching `KEEP_ADVANCE_HISTORY`; the owner disconnecting causes rejection; a reconnect re-announce accepts again; a request committed before the owner disconnected stays pending.
- [ ] 4.4 Remove the session's actors from `pendingWhen` when the entry sees its session's committed `SESSION_LEAVE` or the local disconnect. Verify with a test that a pending conditional publish of a left session is never confirmed, and a late `KV_WHEN_RESOLVED` for it is a no-op.
- [ ] 4.5 In `dispatchLiveEvents`, skip committed records with `opt.when` and `SESSION_JOIN` / `SESSION_LEAVE` records, and feed `KV_EFFECTS` events into `disperseToSubs` behind `SeenEventWindow` (D6). Verify with a test that a committed request is not delivered, and that an effect sent by two replicas is delivered once.

## 5. KV-node evaluator

- [ ] 5.1 Create the KV-node tables (`kv_<realm>`, `session_kv_<realm>`, `kv_lock_<realm>`, `kv_session_<realm>`, `kv_eval_pos`) on realm init in the KV-node process, reusing 3.1. Qualify will and lock session ids by `entry_id`. Verify with a test on a fresh KV-node DB.
- [ ] 5.2 Add the KV-node evaluator, fed by the shared ordering component from `live-dispatch-eventid-ordering`. It filters inputs to topics this node owns, runs the core with the SQLite backend, and writes state plus `kv_eval_pos` in one transaction per input event. Verify with a test that feeds cross-shard events out of arrival order and checks evaluation in eventId order.
- [ ] 5.3 On startup, resume from `kv_eval_pos` (or the oldest fetchable history when absent) via `WireHistoryFetchSource`, and mark the evaluator live once its cursor reaches the stable point. Verify with a restart test: no waiter fires twice, none is lost, and no resolution is sent during catch-up (D7).
- [ ] 5.4 Publish `KV_WHEN_RESOLVED.<entryId>` for each resolution and `KV_EFFECTS` batches for each committed step, only while live (D6/D7). Verify with a test capturing the published messages for applied, rejected, parked-then-fired and will effects.

## 6. Projections take effects

- [ ] 6.1 In `ProjectionListener.applyEvent` (`lib/sqlite/projection_listener.ts`), skip committed records with `opt.when` and `SESSION_JOIN` / `SESSION_LEAVE` records. Verify with a test that a committed conditional request on a projected URI leaves the projection unchanged.
- [ ] 6.2 Feed the KV-node evaluator's committed effects into the co-located `ProjectionListener` in eventId order, so `current_position` can become a derived id (D10). Verify with a test that a fired-waiter effect updates the projection row and sets `current_position` to its derived id, and that resuming from that position skips it.

## 7. Distributed integration

- [ ] 7.1 Add an end-to-end masterfree test (extending the `test/77.kvnode_e2e.ts` setup) with two KV replicas: two clients race `when+watch` on one lock topic, the holder releases, a session with a will disconnects normally, and an entry holding a lock is killed so sync votes its `SESSION_LEAVE`. Assert both replicas end with identical `kv_`, `kv_lock_` and values, each client gets exactly one ack, and subscribers receive only effects.
- [ ] 7.2 Run the parity sequence from 3.4 against the distributed setup and assert the same final values and ack/reject outcomes as the in-memory engine. Then run `npm test` and confirm the full suite passes.

## Workflow follow-up

- Archive the change after `live-dispatch-eventid-ordering` and `session-lifecycle-events` are archived and this change's review is complete.
- Verify that the archived `session-persistent-kv` and `kv-storage-registry` main specs read correctly after the deltas merge.
