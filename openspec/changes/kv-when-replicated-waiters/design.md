# Design

## Context

See `proposal.md` (Why) for the motivation and `specs/replicated-conditional-kv/spec.md` for the required behavior. The current state that shapes the approach:

- **The in-memory KV is the reference behavior.** `MemKeyValueStorage` (`lib/mono/memkv.ts`) covers every topic (`['#']`) with no schema or registration. A `when` publish on any topic is evaluated against the key's current value. The single-SQLite engine matches it through `SqliteKvFabric` (`kv_<realm>`, `session_kv_<realm>`) plus an in-memory `DbEngine.resWhen` list of parked actor objects.
- **Masterfree has no generic KV state.** The entry (`NetEngine`) holds none. ndb storage writes history for the shards it owns only. The KV node (`bin/masterfree/kvnode.ts`) receives every shard via `WireSegmentCommittedSource` but only maintains registered, schema-backed projections. So a lock topic such as `lock.job42` has no value anywhere.
- **The ids already travel on the wire.** `BODY_KEEP_ADVANCE_HISTORY` carries `advanceOwner` (the entry id), `advanceId` (the actor id), `sid` and `opt`. The entry confirms every actor at `ADVANCE_SEGMENT_RESOLVED` (`NetEngineMill.advance_segment_resolved`).
- **Topic ownership is already configured.** `dbNodes.<id>.storage` patterns (`<realm>:<key-pattern>`, `nodeOwnsRealmAndUri` in `lib/masterfree/config.ts`) say which KV nodes own which topics.
- **Cross-shard eventId order is not delivered yet.** The marker-then-fetch component from `live-dispatch-eventid-ordering` (its tasks 5.1/5.5) is still unimplemented, and is blocked on that change's task 2.1.

## Goals / Non-Goals

**Goals:**
- One evaluation core shared by the in-memory engine, the single-SQLite engine and the KV node, so all three give the same outcome for the same input sequence.
- On a KV node, locks work on any retained topic the node owns, with no schema or projection.
- Waiter state and evaluator position survive a KV node restart without double-firing or losing waiters.

**Non-Goals:**
- Gapless history replay of conditional effects. History holds requests only, so replay of conditionally-written keys uses retained state (see the proposal).
- Lock timeouts/TTL, lease renewal, or fairness beyond firing in parked order.
- Evaluation on ndb storage nodes.
- Any change to plain (non-`when`) publish acknowledgment or dispatch.

## Decisions

### D1. KV nodes that own the topic are the evaluators
A conditional request on `realm:topic` is evaluated by every KV node whose `dbNodes.<id>.storage` patterns own it (`nodeOwnsRealmAndUri`). Those nodes are the replicas. ndb nodes are excluded because each one sees only its own shards, and evaluation needs every write to the key in global order.
- *Alternative:* evaluate on ndb. Rejected: no single ndb node sees every shard.
- *Alternative:* every KV node evaluates every topic. Rejected: it ignores the existing ownership config and multiplies state.

### D2. KV-node state lives in three per-realm tables, separate from projections
The evaluator keeps its own state and never reads or writes projection tables:

```
 kv_<realm>          topic PK, value, will_sid, opt, updated_by_msg_id   (existing SqliteKvFabric table)
 session_kv_<realm>  topic PK, value, will_sid, msg_id                   (existing: will records)
 kv_lock_<realm>     request_event_id PK, topic, when, data, opt,         (NEW: session-lock / waiter records)
                     entry_id, sid, actor_id
                     index (topic, request_event_id), index (entry_id, sid)
 kv_session_<realm>  (entry_id, sid) PK                                   (NEW: live sessions from JOIN/LEAVE, D9)
 kv_eval_pos         realm PK, position                                    (NEW: last evaluated eventId)
```

In distributed mode, `will_sid` and `kv_lock.sid` are qualified by `entry_id`, because session ids are only unique per entry. Every evaluation step (one input event plus every effect it causes) is written to these tables and `kv_eval_pos` in one `withWriteLock` transaction. A restart therefore resumes exactly after the last fully applied event, and a waiter can never be half-fired.
- *Alternative:* keep waiters in memory and rebuild them by replay on restart. Rejected: the replay would have to reach back to the oldest live lock, which is unbounded.
- *Alternative:* reuse projections as state. Rejected (user decision B): locks would need a schema and an online projection.

### D3. Ordered input comes from the shared marker-then-fetch component
The evaluator consumes committed events through the reusable ordering component from `live-dispatch-eventid-ordering` (task 5.5), never through raw `SEGMENT_COMMITTED` arrival order. On start, it fetches `(kv_eval_pos, W]` through `WireHistoryFetchSource` and then continues on the same cursor. This change does not ship an interim ordering. A per-shard order would break the "replicas agree" requirement, so this change's implementation tasks start after that component lands.

### D4. One pure evaluation core over a state interface
A single function `evaluate(input, state) -> { effects[], resolutions[] }` takes one ordered input:
- a plain retained write,
- a conditional request,
- `SESSION_JOIN{entryId, sid}`, or
- `SESSION_LEAVE{entryId, sid}` (D9).

It runs against a small state interface: `getValue`, `setValue`, `listWaiters(topic)`, `addWaiter`, `removeWaiter`, `listWills(entryId, sid)`, `removeWill`, `dropSession`.

The memory backend (Maps) is used by `MemKeyValueStorage`. The SQLite backend (the D2 tables) is used by the single-SQLite engine and by the KV node. The core holds no actor objects. The engine around it turns `resolutions` into acknowledgments (D7/D8), and `effects` into subscriber events and projection input (D6, D10).

The order inside one input event at eventId `T`:
1. Apply the input itself:
   - a plain write applies at `T`;
   - a conditional request is evaluated at `T` and comes out applied, parked or rejected;
   - `SESSION_JOIN` adds `(entryId, sid)` to the live-session set;
   - `SESSION_LEAVE` drops that session's waiters, then applies each of its wills in `topic` order, and removes the session from the live set;
   - a conditional request from a session not in the live set (already left) is `rejected`.
2. After every value change, re-check that topic's waiters in `request_event_id` order. The first one that fits fires, then the topic is re-checked again (this gives mutex and chaining).
3. Every effect produced while handling `T`, apart from `T`'s own applied write, gets `T + keyId(n)`. `n` is one counter per trigger event, shared across wills and fired waiters. This is deterministic because the order of steps 1 and 2 is.

### D5. A will is a value change made by the evaluator, not a new published event
Under `SESSION_LEAVE` at `S`, wills are applied as derived effects `S + keyId(n)` (D4). This keeps will application inside the replicated state machine. Today the entry calls `runInboundEvent` after disconnect, so each replica might apply the will at a different point.

### D6. Effects reach entries as a batched broadcast and are deduplicated by eventId
After each evaluation transaction commits, the KV node publishes `KV_EFFECTS{origin, realm, events[]}` to every connected entry. `events` holds the applied and derived effects, with `{eventId, uri, data, opt, sid}`. Entries feed these into `disperseToSubs`, guarded by the existing `SeenEventWindow`, so N replicas produce one delivery. Entries drop committed records carrying `opt.when` from `dispatchLiveEvents`, along with `SESSION_JOIN` / `SESSION_LEAVE` records (D9).

### D7. Resolutions are addressed to the owning entry
For each resolution, the KV node publishes `KV_WHEN_RESOLVED.<entryId>{advanceOwner, advanceId, outcome, eventId?}`. Outcome `applied` comes with the effect eventId, `rejected` comes without one. A parked request sends nothing until it fires.

A KV node that is catching up on history sends nothing. It starts sending once it is live, meaning its cursor has reached W. That is why a cold replica's replay does not produce a burst of stale resolutions. The entry ignores anything it does not hold either way.

### D8. The entry defers acknowledgment of conditional publishes
In `advance_segment_resolved`, actors with `opt.when` get their eventId but are not confirmed. They move into a `pendingWhen` map keyed by `advanceOwner + advanceId`. On the first `KV_WHEN_RESOLVED` for that key, the entry confirms or rejects (`ERROR_INVALID_PAYLOAD`, as local engines do today) and deletes the entry. Later duplicates find nothing and are dropped. A session that closes removes its actors from `pendingWhen`.

### D9. Session lifecycle comes from `session-lifecycle-events`
This change does not define session events. It consumes `SESSION_JOIN` / `SESSION_LEAVE` from `session-lifecycle-events`, which are voted history events. A LEAVE can come from the entry on a normal disconnect, or be voted by sync for a lost entry. The core treats both the same way. The evaluator keeps the live-session set in `kv_session_<realm>` (entry_id, sid), written in the same step transaction as the rest of the state (D2), so the "request after LEAVE is rejected" rule stays deterministic across restarts. Session records are never dispatched to subscribers or applied to projections.
- *Alternative:* the entry-published `SESSION_CLOSED` / `ENTRY_RESET` from an earlier draft. Rejected: it can't cover an entry that never comes back, and it duplicates a mechanism that is useful beyond KV.

### D12. Entries learn KV ownership from announcements and forget it on disconnect
Entries have no `dbNodes` config. When a KV node's `HyperNetEntryLink` opens (including every reconnect), it publishes `KV_NODE_CONNECTED{nodeId, storage}` with its own storage patterns. The entry keeps `nodeId -> parsed patterns` only for connected KV nodes and removes a node when its sys-realm session closes. Before handing a `when` publish to `saveHistory`, the entry checks ownership with the same `match()` grammar as `nodeOwnsRealmAndUri`. If no connected node owns the topic, it rejects with a new retryable error code, distinct from `ERROR_INVALID_PAYLOAD`. Rejecting before commit is always safe, because the request never reaches history. After commit, only replicas decide (D8).
- *Alternative:* keep patterns after disconnect, so clients wait through KV restarts. Rejected (user decision): it means more state on the entry, and clients retrying a pre-commit rejection is safe.
- *Alternative:* load `dbNodes` config on the entry. Rejected: entries are configured by env only.

### D10. Projections take effects, not requests
`ProjectionListener.applyEvent` skips committed records with `opt.when`, and skips `SESSION_JOIN` / `SESSION_LEAVE` records. On a KV node, the evaluator hands its committed `effects` straight to the co-located `ProjectionListener` in eventId order, as projection input next to plain committed records. `current_position` may then be a derived id. Comparison stays plain string order (see the `kv-storage-registry` delta).

### D11. The local engines use the same core and drop actor references
- **`MemKeyValueStorage`:** uses the core with the memory backend. The realm keeps a local `actorId -> actor` map: in mono mode the actorId is the request's local eventId. Resolutions are delivered through that map, so each actor is confirmed with its own message. Waiters live in a per-topic Map, independent of the value row, so they survive a key being deleted.
- **Single-SQLite `DbEngine`:** uses the core with the SQLite backend. `DbEngine.resWhen` is removed. On startup, `kv_lock_<realm>` is cleared, because all its sessions are dead after a restart, and stale wills are applied as today.

## Risks / Trade-offs

- **[Effects and plain events reach subscribers on separate paths]** Plain events go storage → entry; effects go KV → entry. A subscriber can therefore see a later plain write `U` to a topic before an earlier effect `T+a1` on that topic. → Retained/KV state stays correct, because the KV node applies in order. Subscribers that need exact per-topic order should use the retained or snapshot path. This is recorded as a known limitation of option (i). A follow-up could route all KV-owned retained events through `KV_EFFECTS`.
- **[Hard dependency on `live-dispatch-eventid-ordering`]** This change can't ship before it. → The tasks put the shared evaluation core, the memkv rework and the single-SQLite rework first. They don't need the dependency and fix the local bugs now.
- **[Hard dependency on `session-lifecycle-events`]** Without voted LEAVEs, a lost entry's locks and wills are never released. → Groups that need LEAVE are gated on that change, as they are on the ordering dependency.
- **[Lock calls fail while owners reconnect]** With forget-on-disconnect (D12), a KV node restart, or the window right after an entry starts, rejects `when` publishes before commit. → The error is retryable, distinct from condition-not-met, and retrying is always safe because nothing was committed.
- **[Owner lost after commit]** A committed request waits until an owning replica comes back. → This is intended: an entry-side timeout could contradict a later apply.
- **[Mixed versions]** An old entry confirms conditional publishes at segment resolution, and old KV nodes ignore `when`. → All entries and KV nodes must run the new version together. The new wire fields are additive, so plain traffic still works across versions.
- **[Write amplification]** Every owned retained write is now written to `kv_<realm>` on each owning KV node, as well as to any projection. → This is accepted for parity with mono, and is limited by the storage patterns.

## Migration Plan

1. New tables are created with `CREATE TABLE IF NOT EXISTS` on realm init, in both mono single-SQLite and the KV node. Existing `kv_` and `session_kv_` tables are reused unchanged.
2. A KV node with no `kv_eval_pos` row starts from the oldest history it can fetch, and only sends resolutions after it is live (D7).
3. Deploy entries and KV nodes together (see Risks: mixed versions).
4. Rollback: redeploy the previous version. The new tables are ignored by old code and can be dropped. Parked conditional publishes are lost on rollback, the same as on any restart today.

## Open Questions

- Batch size and flush interval for `KV_EFFECTS` (one batch per input segment vs. a time window). This only affects tuning.
- Whether the reserved session-event URI should live under an existing internal prefix or get a new one. It is a naming choice with no behavioral impact.
