## 1. Config: dbNodes accessors

- [ ] 1.1 Add `getDbNodes()` to `lib/masterfree/config.ts`, returning `this.config.dbNodes` (typed `{ [nodeId: string]: any } | undefined`, mirroring `getEventNodes()`); verify it returns the checked-in `supervisor/config.json` `dbNodes` map and `undefined` when the section is absent.
- [ ] 1.2 Add `getDbNodeById(nodeId: string)` returning the single node entry or throwing `Sync/Gate`-style "not found" error consistent with `getSyncById`/`getGateById`; verify with a unit test for both present and missing ids.
- [ ] 1.3 Add `findStoragePatternsForNode(nodeId: string): string[]` returning the node's raw `storage` array, or `[]` when `dbNodes` is absent, the node id is unknown, or `storage` is not an array; verify with a unit test mirroring `test/65.sharding.ts`'s `Config.findShardsForNode()` cases (present, unknown id, missing section).

## 2. Config: storage pattern parsing and matching

- [ ] 2.1 Add a `parseStoragePattern(pattern: string): { realm: string; keyPattern: string[] }` helper (splitting on the first `:`, parsing the key-pattern segment with `defaultParse()` from `lib/topic_pattern.ts`); verify with unit tests for an exact realm, a `*` wildcard realm, and a multi-segment dotted key-pattern.
- [ ] 2.2 Add a `nodeOwnsRealmAndUri(nodeId: string, realmName: string, uriParts: string[]): boolean` helper that parses the node's patterns and applies `match()` from `lib/topic_pattern.ts` per pattern (realm exact-or-`*`, then topic `match`); verify with unit tests covering: exact-realm match, wildcard-realm match, non-matching realm, matching key-pattern, non-matching key-pattern, and a node with multiple patterns where only one covers the input.

## 3. Config: validation

- [ ] 3.1 Add `validateStorageForNode(nodeId: string): void`, mirroring `validateShardsForNode`, throwing when a pattern has no `:` separator or an empty realm/key-pattern segment; verify with unit tests for each malformed case and a passing case with well-formed patterns (including `*:*`).

## 4. Spec sync

- [ ] 4.1 Confirm `openspec/changes/add-kv-node-topology/specs/dbnode-topology/spec.md` requirements are each covered by a task above (or explicitly deferred in design.md's Open Questions) before this change is archived.
- [ ] 4.2 Confirm `openspec/changes/add-kv-node-topology/specs/distributed-mode/spec.md` delta is ready to sync into `openspec/specs/distributed-mode.md` at archive time (architecture list gains KV-node, lifecycle note added, no changes to the existing "Distributed retained event synchronization" requirement).

## 5. Tests

- [ ] 5.1 Add a `Config.getDbNodes()`/`getDbNodeById()`/`findStoragePatternsForNode()` test block to `test/65.sharding.ts` (or a new `test/6x.dbnodes.ts`), following the existing `describe('Config.findShardsForNode()', ...)` structure; verify `npm test` passes.
- [ ] 5.2 Add `parseStoragePattern`/`nodeOwnsRealmAndUri`/`validateStorageForNode` unit tests to the same file; verify `npm test` passes (lint + build + mocha).

## 6. Hand-off

- [ ] 6.1 Share this change's proposal/design/spec deltas with `kv-node` and `event-history-node` as the frozen contract for the follow-on KV-node process implementation (no code task here — tracking note for the architect handing off).
