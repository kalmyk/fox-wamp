## Context

`supervisor/config.json` already carries a `dbNodes` section (`KV1`, `KV2`, both `storage: ["*:*"]`) but nothing consumes it — `lib/masterfree/config.ts` has no accessor. The nearest precedent is `eventNodes`/`shards`: `Config.getEventNodes()`, `Config.findShardsForNode(nodeId)`, `Config.validateShardsForNode(nodeId)`, consumed by `bin/masterfree/ndb.ts` at startup to determine which `KEEP_ADVANCE_HISTORY.<shardTag>` topics a storage node subscribes to (see `add-distributed-message-sharding`, fully implemented, not yet archived).

Today, KV/admin logic runs in two places:
- `lib/mono/onedbrouter.ts` (`OneDbRouter`): `AdminApiServer` is constructed per-realm inside `router.createRealm(realmName)`, lazily, the first time a realm is touched. This is the only place `AdminApiServer` is wired up at all.
- `bin/masterfree/ndb.ts`: `ProjectionListener` and `SqliteKvFabric` are already constructed alongside `EventStorageTask`/`StageTwoTask`, sharing the same `DbFactory`/db handle and node process — but `AdminApiServer` is **not** wired in here (confirmed gap, not yet built).

`EventStorageTask.commit_segment` already does two things after a segment commits: it emits `SEGMENT_COMMITTED` in-process on `dbFactory` (consumed today by the co-located `ProjectionListener`), and it separately publishes `Event.SEGMENT_COMMITTED` over HyperNet into the sys realm via `this.api.publish(...)`, which is already piped live-tail to every attached entry node (`storageTask.listenEntry`). The wire path already exists; only a subscriber on the KV-node side is new.

See `openspec/specs/distributed-mode.md` for the full lifecycle and the stateless-voting invariants this proposal must not disturb, and `openspec/specs/kv-storage-registry/spec.md` for the projection lifecycle (`inactive → refreshing → online/failed`) this proposal does not change.

## Goals / Non-Goals

**Goals:**
- Give `Config` a first-class, tested accessor surface for `dbNodes`, symmetric with the existing `eventNodes` surface.
- Define the `<realm>:<key-pattern>` grammar precisely enough that `kv-node` can implement matching against it without inventing a second pattern language.
- Establish, as a documented contract, that KV-node instances are stateless-w.r.t.-voting, redundant-tolerant consumers — so the eventual dedicated process can be implemented without re-litigating cluster-topology questions.
- Identify, explicitly, the parts of the KV-node split this proposal does *not* settle, so `kv-node`'s implementation change knows what it still owns.

**Non-Goals:**
- Building `bin/masterfree/kvnode.ts` or moving `AdminApiServer`/`ProjectionListener`/`SqliteKvFabric` construction out of `OneDbRouter`/`ndb.ts`.
- Changing `lib/masterfree/hyper.h.ts`, `EventStorageTask`, or the StageOne/StageTwo protocol in any way.
- Solving realm-discovery for wildcard (`*`) realm storage patterns (see Open Questions) — this proposal defines what "covered" means, not how a not-yet-instantiated realm's admin surface gets registered.
- Sharding or filtering the `SEGMENT_COMMITTED` broadcast itself at the publisher (storage-node) side. It stays a broadcast to every attached entry, exactly as today; a KV-node filters client-side, the same way `ProjectionListener.handleSegmentCommitted`'s `forEachRealm` + per-projection `uriPattern` check already filters today.

## Decisions

### 1. Config accessors mirror `eventNodes` exactly
`getDbNodes()`, `getDbNodeById(nodeId)`, `findStoragePatternsForNode(nodeId): string[]`, `validateStorageForNode(nodeId): void`. Rationale: this is the second cluster-topology config section after `eventNodes`; reusing its exact shape and naming keeps `config.ts` predictable and lets `validateStorageForNode` follow the same fail-fast-at-startup convention already used in `bin/masterfree/ndb.ts` (`config.validateShardsForNode(conf_node_id)` called before the node starts serving).

Alternative considered: a single generic `getNodesOfType(type)` accessor. Rejected — `eventNodes` and `dbNodes` have different per-entry shapes (`shards: number[]` vs `storage: string[]`) and different validation rules; a generic accessor would need to be typed as `any` at the call site anyway, losing the benefit.

### 2. Pattern grammar: split-on-first-`:`, reuse `topic_pattern.ts`
`<realm>:<key-pattern>` splits on the *first* `:` only (a key-pattern segment itself may validly be a single dotted token with no `:`, since FOX topics never contain `:`; this rules out ambiguity without needing an escape syntax). Realm is `*` or an exact name — not a topic pattern; there is exactly one flat namespace of realm names and no established sub-realm hierarchy to pattern-match against, so a topic-style wildcard (`app.*`) does not apply. `key-pattern` reuses `defaultParse()`/`match()` from `lib/topic_pattern.ts` verbatim — the same functions already used by `KvProjection.applyEvent` to compare a committed event's URI against a projection's `uri_pattern`, and by `AdminApiServer`'s schema `urlPattern`. This keeps exactly one pattern-matching implementation in the codebase for this concept, avoiding subtly different wildcard semantics between "does this event match a projection" and "does this projection fall inside a node's declared responsibility."

Alternative considered: a full glob syntax over `realm.key.path` as one combined dotted string (no `:` separator, realm is just the first path segment). Rejected — realms and topics are already validated/typed as separate concepts everywhere else in the codebase (`BaseRealm`, `realmName` columns, `storage_desc_${realmName}` table naming); collapsing them into one path would require every consumer to special-case "first segment is actually the realm," which is more error-prone than a single `:` split.

### 3. Overlap = independent redundancy, no coordination
Directly reuses the `eventNodes.shards` precedent (DB1:[0,1,2,3] / DB2:[2,3,4,5] already overlap in the checked-in config, and `EventStorageTask` instances for different `advanceOwner`s already run fully independently against their own `DbFactory`). A KV-node is single-writer only to its *own* SQLite file; two KV-nodes with overlapping `storage` patterns each maintain their own copy, and nothing in `kv-storage-registry`'s activation/replay logic (idempotent, ordered by committed `eventId` string, `INSERT OR REPLACE` semantics) requires them to agree. This is what makes the "no leader election" claim safe rather than aspirational.

Alternative considered: treat overlapping patterns as a config error requiring disjoint partitioning (an actual shard map, like `eventNodes.shards`). Rejected for this proposal — the checked-in example config already has two nodes both declaring `"*:*"`, which reads as intentional full replication for HA/read-scaling, not a mistake to reject. Partition-style disjoint ownership remains expressible (patterns simply don't overlap); this design does not forbid it, it just doesn't require it.

### 4. Reuse the existing `SEGMENT_COMMITTED` wire broadcast; no new event
Confirmed by reading `lib/masterfree/storage.ts`: `EventStorageTask.commit_segment` already does `this.api.publish(Event.SEGMENT_COMMITTED, result, {exclude_me: false})` into the sys realm, and `storageTask.listenEntry` already pipes that broadcast live-tail to every attached entry node. A KV-node process, connecting outward to entry FOX ports the same way `ndb.ts`'s `mkGate`/`mkSync` helpers already do for storage nodes, can subscribe to that same event on the sys realm — `ProjectionListener` already accepts a `SegmentCommittedSource` (currently `dbFactory`, an in-process `EventEmitter`); a wire-fed adapter implementing the same `on(SEGMENT_COMMITTED, handler)` surface is a drop-in swap, not a new contract. This is the central reason this proposal does not need to touch `hyper.h.ts`.

### 5. Node-level responsibility gate scoped to registration, not to every read
The `storage` pattern gate (`Requirement: Node-Level Storage Responsibility Gate` in the spec delta) applies to registering new projection/schema state (`KV_ADD`/`SCHEMA_ADD`) — the point where a human or `foxctl` operator picks *which* KV-node a projection's data should live on. It intentionally does not re-litigate the existing per-event `uriPattern` match `KvProjection.applyEvent` already performs on every commit; that stays exactly as-is. Two independent filters (node-level "am I even supposed to host anything for this realm/pattern" and projection-level "does this specific event match this specific registered projection") compose cleanly and keep each check's blast radius small.

### 6. Duplicate `SEGMENT_COMMITTED` delivery is safe by construction, not something this proposal must dedup
A KV-node attaching to more than one entry node for availability (so it keeps receiving `SEGMENT_COMMITTED` if one entry goes down) will observe the same committed segment once per attached entry. This does not need new dedup logic: `KvProjection.applyEvent`'s writes are `INSERT OR REPLACE` upserts keyed by the schema's primary key, and `ProjectionListener.handleSegmentCommitted`'s `advancePosition` call is an unconditional, monotonically-non-decreasing `UPDATE current_position = ?` — reapplying the same committed segment a second time is a no-op in effect, just redundant work. Verified directly against the current `lib/sqlite/projection_listener.ts` implementation rather than assumed.

## Risks / Trade-offs

- **[Risk]** A misconfigured `dbNodes.storage` pattern (e.g. two nodes with deliberately disjoint patterns, one node down) could leave a realm+pattern combination with *zero* covering KV-node, silently dropping projection availability for it → **Mitigation**: `validateStorageForNode` catches malformed *syntax* at startup, but cross-node coverage-gap detection (no node covers X) is a cluster-wide check, not a single-node one, and is left to `kv-node`'s `EVENT_SHARD_LIST`-style admin listing (a `KV_NODE_LIST`/coverage-report analog) as follow-on work — flagged in Open Questions below rather than solved here, since it does not change this proposal's spec surface.
- **[Risk]** Wildcard (`*:*`) realm coverage on a KV-node conflicts with the fact that nothing today broadcasts "a new realm was created" — so a KV-node with `*:*` cannot proactively register admin RPC surfaces for realms it hasn't yet observed a committed event or an explicit `KV_ADD`/`SCHEMA_ADD` call for → **Mitigation**: out of scope for this proposal by design (see Non-Goals); `kv-node`'s implementation change must resolve this before wiring `AdminApiServer` into a standalone KV-node process. Concretely deferred, not silently dropped — captured in Open Questions.
- **[Trade-off]** Reusing the broadcast `SEGMENT_COMMITTED` (rather than a per-KV-node-filtered topic, à la `KEEP_ADVANCE_HISTORY.<shardTag>`) means every attached KV-node receives every committed segment from every entry it's attached to, regardless of its own `storage` patterns, and filters client-side. This matches today's `ProjectionListener` behavior exactly (no regression) but does not reduce wire/CPU cost the way shard-topic routing did for `KEEP_ADVANCE_HISTORY`. Deliberately deferred — see Open Questions; `event-history-node` should weigh in before it's built, since introducing per-pattern topic routing here would touch `EventStorageTask`, which this proposal explicitly does not.

## Migration Plan

Purely additive: new `Config` methods, no changes to existing method signatures, no changes to the on-disk config schema (the `dbNodes` section is already checked in). Existing single-process (`OneDbRouter`) and current masterfree (`entry`/`sync`/`ndb`) deployments are unaffected — nothing calls the new accessors until a KV-node implementation change consumes them. No rollback concerns beyond reverting the `config.ts` addition and the two spec deltas.

## Open Questions

- Should `SEGMENT_COMMITTED` gain per-realm or per-pattern topic routing (mirroring `KEEP_ADVANCE_HISTORY.<shardTag>` from `add-distributed-message-sharding`) once KV-node fan-out is a real deployment, or is broadcast + client-side filtering sufficient at expected realm/projection counts? Left to `event-history-node` to weigh in on when `kv-node`'s implementation change is scoped — does not change this proposal's spec surface, since either answer is compatible with "reuse the existing event, no new event type" as stated here.
- How does a KV-node with a wildcard (`*`) realm storage pattern learn about a realm's existence *before* any event has been committed for it, so it can accept a `KV_ADD`/`SCHEMA_ADD` call for a brand-new realm? Candidates include: an explicit realm-announce mechanism, requiring `foxctl`/admin tooling to target a specific KV-node by id for first-time registration rather than relying on wildcard routing, or restricting wildcard patterns to catch-up/read-scaling replicas only (never the registration target). Left to `kv-node`'s implementation change.
- What replaces `AdminEvent.EVENT_SHARD_LIST`'s coverage-listing convenience for `dbNodes` (i.e. a `KV_NODE_LIST`-equivalent enumerating which node(s) cover a given realm+pattern, for `foxctl`/operators)? Natural follow-on, not required for the config contract itself.
