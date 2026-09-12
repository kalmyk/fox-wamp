## 1. Config: dbNodes accessors

- [x] 1.1 Add `getDbNodes()` to `lib/masterfree/config.ts`, returning `this.config.dbNodes` (typed `{ [nodeId: string]: any } | undefined`, mirroring `getEventNodes()`); verify it returns the checked-in `supervisor/config.json` `dbNodes` map and `undefined` when the section is absent.
- [x] 1.2 Add `getDbNodeById(nodeId: string)` returning the single node entry or throwing `Sync/Gate`-style "not found" error consistent with `getSyncById`/`getGateById`; verify with a unit test for both present and missing ids.
- [x] 1.3 Add `findStoragePatternsForNode(nodeId: string): string[]` returning the node's raw `storage` array, or `[]` when `dbNodes` is absent, the node id is unknown, or `storage` is not an array; verify with a unit test mirroring `test/65.sharding.ts`'s `Config.findShardsForNode()` cases (present, unknown id, missing section).

## 2. Config: storage pattern parsing and matching

- [x] 2.1 Add a `parseStoragePattern(pattern: string): { realm: string; keyPattern: string[] }` helper (splitting on the first `:`, parsing the key-pattern segment with `defaultParse()` from `lib/topic_pattern.ts`); verify with unit tests for an exact realm, a `*` wildcard realm, and a multi-segment dotted key-pattern.
- [x] 2.2 Add a `nodeOwnsRealmAndUri(nodeId: string, realmName: string, uriParts: string[]): boolean` helper that parses the node's patterns and applies `match()` from `lib/topic_pattern.ts` per pattern (realm exact-or-`*`, then topic `match`); verify with unit tests covering: exact-realm match, wildcard-realm match, non-matching realm, matching key-pattern, non-matching key-pattern, and a node with multiple patterns where only one covers the input.
- [x] 2.3 Fix the `*` vs `#` wildcard-completeness gotcha (see design.md Decision 2 correction): `match()` requires equal parsed length unless the filter uses `#`, so key-pattern `*` only matches single-segment topics, not "every key regardless of depth." Correct `supervisor/config.json`'s `dbNodes.storage` example from `"*:*"` to `"*:#"` for `KV1`/`KV2`, and add a unit test asserting `nodeOwnsRealmAndUri` returns `true` for a multi-segment URI (e.g. `["orders", "created"]`) under a `"*:#"` pattern and `false` under `"*:*"`.

## 3. Config: validation

- [x] 3.1 Add `validateStorageForNode(nodeId: string): void`, mirroring `validateShardsForNode`, throwing when a pattern has no `:` separator or an empty realm/key-pattern segment; verify with unit tests for each malformed case and a passing case with well-formed patterns (including `*:*`).

## 4. Spec sync

- [x] 4.1 Confirm `openspec/changes/add-kv-node-topology/specs/dbnode-topology/spec.md` requirements are each covered by a task above (or explicitly deferred in design.md's Open Questions) before this change is archived. — Verified: "dbNodes Configuration Accessors" (1.1-1.3), "Storage Pattern Grammar" (2.1-2.2), "Storage Pattern Validation" (3.1) are implemented and tested. "Node-Level Storage Responsibility Gate" delivers the reusable primitive (`nodeOwnsRealmAndUri`) here; actual enforcement at `KV_ADD`/`SCHEMA_ADD` registration time is correctly deferred to `kv-node`'s implementation change per this proposal's Non-Goals (no `bin/masterfree/kvnode.ts`/`AdminApiServer` wiring in this pass). "Overlapping Storage Responsibility" is satisfied by omission — nothing here validates cross-node disjointness, so overlap is never rejected. "Downstream-Only Committed Event Consumption" is entirely about the not-yet-built KV-node process's runtime behavior and is correctly deferred to `kv-node`'s implementation change.
- [x] 4.2 Confirm `openspec/changes/add-kv-node-topology/specs/distributed-mode/spec.md` delta is ready to sync into `openspec/specs/distributed-mode.md` at archive time (architecture list gains KV-node, lifecycle note added, no changes to the existing "Distributed retained event synchronization" requirement). — Verified against the current spec: architecture list is 3 bullets today (Entry/NDB Storage/Sync Cluster), delta adds KV-node as a 4th with no conflict; the delta's "excluded from stateless voting invariants" scenario matches the existing Stateless Voting Invariants table's three-node scope exactly (no edit needed there, delta only narrates the exclusion).

## 5. Tests

- [x] 5.1 Add a `Config.getDbNodes()`/`getDbNodeById()`/`findStoragePatternsForNode()` test block to `test/65.sharding.ts` (or a new `test/6x.dbnodes.ts`), following the existing `describe('Config.findShardsForNode()', ...)` structure; verify `npm test` passes. — Done in `test/67.dbnodes.ts`; `npm test` passes (335 passing).
- [x] 5.2 Add `parseStoragePattern`/`nodeOwnsRealmAndUri`/`validateStorageForNode` unit tests to the same file; verify `npm test` passes (lint + build + mocha). — Done in `test/67.dbnodes.ts`.

## 6. Hand-off

- [x] 6.1 Share this change's proposal/design/spec deltas with `kv-node` and `event-history-node` as the frozen contract for the follow-on KV-node process implementation (no code task here — tracking note for the architect handing off). — Done: both consulted directly against this change's artifacts; both edited `design.md` in place with their own corrections/resolutions (see Decision 4/6 corrections and the resolved Open Questions).
- [x] 6.2 Flag to `kv-node`'s implementation change (see design.md Decision 6 correction): redundant multi-entry attachment must be consumed as active/standby failover (exactly one source driving `handleSegmentCommitted` at a time), not concurrently, until either a per-key applied-event-id check is added to `KvProjection.applyEvent` or `advancePosition`/`handleSegmentCommitted` gains an explicit high-water-mark comparison that refuses to move a projection's position backward. No code task here — tracking note for `kv-node`'s implementation change. — Flag recorded in `design.md` Decision 6 by `kv-node` itself; carries forward to its own implementation change.
