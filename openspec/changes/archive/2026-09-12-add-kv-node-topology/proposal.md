## Why

The masterfree KV/admin surface (`AdminApiServer`, `StorageRegistry`, `SchemaRepository`, `ProjectionListener`) is currently only wired up inside `OneDbRouter` (single-SQLite mode) and, partially, co-located in-process with `EventStorageTask`/`StageTwoTask` inside `bin/masterfree/ndb.ts`. `supervisor/config.json` already carries an aspirational `dbNodes` section (`KV1`, `KV2`, each with a `storage: ["<realm>:<key-pattern>"]` list) describing a dedicated KV-node process type, but nothing in `lib/` or `bin/` reads it — `lib/masterfree/config.ts` has no accessor for `dbNodes` at all. Before a dedicated KV-node process can be built, the cluster needs a config-level contract for which realm+URI-pattern combinations each KV-node instance is responsible for, and how that responsibility interacts with the existing entry/sync/storage message lifecycle.

## What Changes

- Add `getDbNodes()`, `getDbNodeById(nodeId)`, `findStoragePatternsForNode(nodeId): string[]`, and `validateStorageForNode(nodeId)` to `lib/masterfree/config.ts`, mirroring the existing `getEventNodes()`/`findShardsForNode()`/`validateShardsForNode()` pattern used for `eventNodes`/shards.
- Define the `<realm>:<key-pattern>` grammar: split on the first `:`; `realm` is an exact realm name or `*` (any realm); `key-pattern` is a dotted FOX topic pattern parsed and matched with the existing `lib/topic_pattern.ts` `defaultParse()`/`match()` — the same matcher `KvProjection.applyEvent` already uses for `uri_pattern`. No new pattern-matching engine is introduced.
- Define the node-level responsibility gate: a KV-node instance may register (`KV_ADD`/`SCHEMA_ADD`) a projection/schema for a given realm+`urlPattern` only when that combination is covered by at least one of the node's own `storage` patterns.
- Define overlap semantics: multiple `dbNodes` entries may declare overlapping or identical `storage` patterns (as in the checked-in `KV1`/`KV2` example, both `"*:*"`). This is explicitly allowed and means independent, redundant projection computation with no coordination or leader election between KV-node instances — the same precedent already accepted for overlapping `eventNodes.shards` ranges across storage nodes.
- Define the cross-process feed contract for a standalone KV-node: reuse the `Event.SEGMENT_COMMITTED` broadcast that `EventStorageTask` already publishes into each entry node's sys realm (and already pipes live-tail to every attached entry) — a KV-node connects outward to entry nodes' FOX ports the same way `bin/masterfree/ndb.ts`'s existing `mkGate`/`mkSync` helpers do, logs into the sys realm, and subscribes to `Event.SEGMENT_COMMITTED` there instead of the in-process `dbFactory.emit()` path used when `ProjectionListener` is co-located with `EventStorageTask` today. No new event or topic type is introduced.
- Document the KV-node as a fourth masterfree node type in `distributed-mode.md`, downstream of segment commitment, with **no participation in StageOne/StageTwo ID-election voting** — preserving the stateless-voting invariants (no new heap-accumulation risk, no wall-clock-dependent ordering).
- Explicitly out of scope (flagged as open follow-on work for the `kv-node` agent's implementation change): moving `AdminApiServer`/`ProjectionListener`/`SqliteKvFabric` construction into a new `bin/masterfree/kvnode.ts` entrypoint, and the realm-discovery mechanism a KV-node needs to expose per-realm admin RPC surfaces before any event for that realm has ever been committed (acute under wildcard `"*"` realm patterns, where there is no existing "realm was created" broadcast to hook into, unlike `OneDbRouter`'s `router.createRealm` override).

## Capabilities

### New Capabilities
- `dbnode-topology`: The `dbNodes` config section, its accessors on `Config`, the `<realm>:<key-pattern>` grammar and matching rules, per-node storage-responsibility validation, and overlap/redundancy semantics across KV-node instances.

### Modified Capabilities
- `distributed-mode`: Adds the KV-node as a fourth architecture component, downstream of `SEGMENT_COMMITTED`, explicitly outside the StageOne/StageTwo voting path.

## Impact

- `lib/masterfree/config.ts`: new `dbNodes` accessors and pattern parsing/validation (additive; no existing method signatures change).
- `supervisor/config.json`: `dbNodes` section already present (no schema change required by this proposal).
- `openspec/specs/distributed-mode.md`: architecture list gains the KV-node; sequence description gains a short KV-node ingestion note.
- No changes to `lib/masterfree/hyper.h.ts`, `lib/masterfree/synchronizer.ts`, `lib/masterfree/storage.ts`, `lib/sqlite/*`, or `lib/masterfree/admin_api.ts` in this proposal — those are implementation surfaces for the follow-on `kv-node`/`event-history-node` change(s) that consume this contract.
- Testing: unit tests for `Config.findStoragePatternsForNode()`/`validateStorageForNode()`/pattern parsing, mirroring the existing `Config.findShardsForNode()` test pattern in `test/65.sharding.ts`.
