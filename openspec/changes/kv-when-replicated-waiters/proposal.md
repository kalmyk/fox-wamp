# Proposal

## Why

Conditional KV updates (`when`, `watch`: wait-for-lock) work only on local engines, and only because the engine keeps the parked actor object in memory and calls `confirm()` on it when the condition is met. On the net-engine (masterfree) the entry node has no KV state, every publish is committed and confirmed at `ADVANCE_SEGMENT_RESOLVED`, and `opt.when` is never evaluated, so wait-for-lock is simply broken in distributed mode. The KV state lives on remote nodes, so they must decide when a waiter fires. That requires waiters to be data addressed by entry/session/actor ids, not callbacks.

## What Changes

- **Waiters become records, not actor references.** A parked conditional publish is stored as `{topic, when, data, opt, entryId, sessionId, actorId, requestEventId}`. In masterfree, `entryId` = `advanceOwner` and `actorId` = `advanceId`, which `KEEP_ADVANCE_HISTORY` already carries. The entry keeps only a reply handle keyed by actorId.
- **Replicated evaluation.** Every KV node evaluates committed conditional requests in global eventId order against its KV state, deterministically, as a replicated state machine. Outcomes are `applied`, `parked` (watch) or `rejected`. This requires cross-shard eventId-ordered apply.
- **Derived event ids for effects.** When a waiter fires at trigger event `T`, the effective update gets id `T + keyId(n)` (n = position in the chain of waiters fired at `T`). No separator is needed: a real eventId is `dt(10 fixed chars) + keyId(segment) + keyId(offset)`, and every part is fixed-width or length-prefixed, so real ids are prefix-free and a derived id (four parts) can never equal a real one (three parts). A derived id sorts strictly between `T` and the next real event and needs no extra consensus round. Derived ids are not fed to `ProduceId.reconcileStrId`, which parses only the first three parts.
- **Requests vs. effects.** Committed history keeps the conditional *request* as consensus output. Entries stop live-dispatching `opt.when` requests from storage `SEGMENT_COMMITTED`. KV nodes publish effective (applied and derived) events to entries, and entries dedup them by eventId across KV replicas. Replay of conditionally-written keys relies on retained or snapshot state, not on history.
- **New wire event `KV_WHEN_RESOLVED`** `{advanceOwner, advanceId, outcome, eventId?}` from KV nodes to the owning entry. The entry confirms or rejects conditional publishes on it (deduped across replicas) instead of at `ADVANCE_SEGMENT_RESOLVED`. Plain publishes are unchanged.
- **Session lifecycle comes from history.** KV replicas consume `SESSION_JOIN` / `SESSION_LEAVE` from `session-lifecycle-events`. At a committed `SESSION_LEAVE` (sent by the entry, or voted by sync for a lost entry) every replica drops the session's waiters and applies its `will` records, replacing local `eraseSessionData` callbacks on the net path. Requests from a sid after its committed LEAVE are rejected.
- **KV ownership is announced to entries.** On connect, each KV node sends `KV_NODE_CONNECTED{nodeId, storage}` with its own `dbNodes` storage patterns. The entry keeps them only while that KV node is connected, and forgets them on disconnect. Before commit, the entry rejects a `when` publish that no connected KV node owns, using a distinct retryable error code (separate from "condition not met"). After commit, only replicas decide; the entry never rejects on a timeout.
- **In-memory KV (`MemKeyValueStorage`) moves to the same model.** It stores waiter and will records, evaluates in local order, and resolves through a local dispatcher keyed by actorId. This also fixes chained waiters being confirmed with the triggering actor's `msg`, and parked waiters being lost when a key's value merges to empty and its row is deleted.
- KV projections (`ProjectionListener`) apply only effective outcomes, never parked or rejected requests, and their watermark accepts derived ids.

## Capabilities

### New Capabilities
- `replicated-conditional-kv`: deterministic evaluation of `when`/`watch` requests across KV replicas, the waiter record model (entry/session/actor ids), derived effect ids, `KV_WHEN_RESOLVED` delivery and deduplication, and how effective events reach subscribers.

### Modified Capabilities
- `session-persistent-kv`: "Conditional KV updates", "Reactive Waiting (Watch)" and "Application of session-persistent KV updates" are written for local/Single DB engines only. They are extended to the in-memory record model and to distributed mode, where waiter drop and `will` application are triggered by an ordered `SESSION_LEAVE` history event.
- `kv-storage-registry`: "Committed Segment Projection" and "Text Event Position Tracking" change. Projections apply effective outcomes only (not conditional requests), and the watermark may be a derived event id.

## Impact

- **Code:** `lib/mono/memkv.ts` (rewrite of the waiter model), `lib/realm.ts` (`KeyValueStorageAbstract`, `ActorPushKv`, a new local resolution dispatcher), `lib/masterfree/netengine.ts` (deferred confirm for conditional publishes, suppressed live dispatch of requests, connected-owner table and pre-commit check, `KV_WHEN_RESOLVED` handling), `lib/masterfree/hyper.h.ts` (new events and bodies), the KV-node side (`lib/masterfree/kvnode.ts`, `kvnoderouter.ts`, `lib/sqlite/projection_listener.ts`, `lib/sqlite/sqlitekv.ts`) for the evaluator and waiter/will tables. `DbEngine.resWhen` in `lib/mono/dbengine.ts` is aligned to the record model (the scope boundary is to be settled in design).
- **Wire protocol:** new `KV_WHEN_RESOLVED`, `KV_EFFECTS` and `KV_NODE_CONNECTED` events. Confirm timing changes for conditional publishes on the net-engine.
- **Dependencies:** requires the cross-shard eventId-ordered apply from `live-dispatch-eventid-ordering` (currently blocked on its task 2.1), and `SESSION_JOIN` / `SESSION_LEAVE` from `session-lifecycle-events`.
- **Open items for design:** whether ndb storage nodes need the evaluator or only KV nodes; how the retained snapshot interacts with derived ids; whether migrating `DbEngine.resWhen` belongs in this change or a follow-up.
