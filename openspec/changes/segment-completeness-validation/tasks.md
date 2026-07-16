## 1. Protocol Field

- [ ] 1.1 Add `totalCrc32: number` to `BODY_ADVANCE_SEGMENT_OVER` in `lib/masterfree/hyper.h.ts`.
- [ ] 1.2 Widen `computeUriCrc`'s parameter type in `lib/sqlite/segment_registry.ts` from `BODY_KEEP_ADVANCE_HISTORY[]` to `{ uri: string[] }[]` (structurally compatible, non-breaking).

## 2. Entry-Side Computation

- [ ] 2.1 In `lib/masterfree/netengine.ts`, compute `totalCrc32` from `HistorySegment.getAllActors()` (mapping each `ActorPush` via `getUri()` into `{ uri }`) using `computeUriCrc`, when building the `ADVANCE_SEGMENT_OVER` body at the normal-completion site (`netengine.ts:172-179`).
- [ ] 2.2 Apply the same `totalCrc32` computation at the failed-segment `ADVANCE_SEGMENT_OVER` emission site (`netengine.ts:282-288`).

## 3. Segment Validation Storage

- [ ] 3.1 Add `createSegmentValidationTable(db)` in `lib/sqlite/segment_registry.ts` (or a new sibling module) — `CREATE TABLE IF NOT EXISTS segment_validation (advance_owner TEXT, advance_stamp INTEGER, shard_tag INTEGER, expected_msg_count INTEGER, expected_crc32 INTEGER, actual_msg_count INTEGER, actual_crc32 INTEGER, status TEXT, PRIMARY KEY (advance_owner, advance_stamp))`. Table is global (not per-realm).
- [ ] 3.2 Call `createSegmentValidationTable` once during storage node bootstrap (e.g. alongside `createHistoryTables`/`ensureRealm`'s table setup, guarded so it only runs once despite being realm-agnostic).
- [ ] 3.3 Add `recordExpectedTotals(db, advanceOwner, advanceStamp, shardTag, totalEvents, totalCrc32)` — `INSERT OR IGNORE ... status='pending'` (idempotent, mirrors `insertSegmentOver`).
- [ ] 3.4 Add `recordActualTotals(db, advanceOwner, advanceStamp, actualMsgCount, actualCrc32)` — UPSERT that sets `actual_msg_count`, `actual_crc32`, and derives `status`: `'match'` if expected totals exist and both equal actual, `'mismatch'` if expected totals exist and differ, `'unvalidated'` if no expected totals were ever recorded for this row.

## 4. Wiring Into Storage Node

- [ ] 4.1 In `EventStorageTask`'s `ADVANCE_SEGMENT_OVER` handler (`lib/masterfree/storage.ts:77-95`), call `recordExpectedTotals` with `body.totalEvents`/`body.totalCrc32`, alongside the existing per-realm `insertSegmentOver` calls.
- [ ] 4.2 In `dbSaveSegment` (`storage.ts:169-207`), after the existing per-realm `updateSegmentResolved` loop, sum `msgCount`/`crc32` across all realms processed in that call and invoke `recordActualTotals` inside the same transaction, before `COMMIT`.
- [ ] 4.3 On `status='mismatch'`, log a `console.error` including `advanceOwner`, `advanceStamp`, expected and actual `msg_count`/`crc32`.
- [ ] 4.4 Confirm a mismatch does not affect the transaction outcome, `SEGMENT_COMMITTED` emission, or `CommittedSegmentRecord[]` returned to callers.

## 5. Admin Surface

- [ ] 5.1 Extend `SegmentRecord`/`AdminSegmentListResponse` in `lib/masterfree/hyper.h.ts` with `validationStatus: string | null`.
- [ ] 5.2 In the `fox.admin.segment.list` handler (`lib/masterfree/admin_api.ts`), join each returned `segment_registry_<realm>` row to its `segment_validation` row by `(advance_owner, advance_stamp)` and populate `validationStatus` (`null` if no matching row).
- [ ] 5.3 Update `foxctl segment list` output (table and `--json`) to include the `validationStatus` column, if `foxctl`'s segment-list formatting is a flat column list.

## 6. Tests

- [ ] 6.1 Unit test: entry-side `totalCrc32` computation (via the widened `computeUriCrc`, fed `ActorPush`-shaped URIs) matches storage-side `computeUriCrc` output for the same set of events.
- [ ] 6.2 Integration test: a segment with matching entry/storage totals ends with `segment_validation.status='match'`.
- [ ] 6.3 Integration test: inject a dropped or extra `KEEP_ADVANCE_HISTORY` event on the storage side (simulating loss) and confirm `segment_validation.status='mismatch'` with correct expected/actual values, and that the segment still commits and `SEGMENT_COMMITTED` still fires.
- [ ] 6.4 Integration test: `ADVANCE_SEGMENT_RESOLVED` processed with no prior `ADVANCE_SEGMENT_OVER` row → `segment_validation.status='unvalidated'`.
- [ ] 6.5 Test `fox.admin.segment.list` / `foxctl segment list` surface `validationStatus` correctly for match, mismatch, unvalidated, and no-row cases.

## 7. Build and Final Checks

- [ ] 7.1 Run full test suite; ensure no regressions in existing `segment-registry` tests (`test/66.segment_registry.ts`).
- [ ] 7.2 Run `openspec status --change segment-completeness-validation` and confirm all artifacts complete.
