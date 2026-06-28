## 1. SQLite Helper Module

- [ ] 1.1 Create `lib/sqlite/segment_registry.ts` with `createSegmentRegistryTable(db)` — `CREATE TABLE IF NOT EXISTS segment_registry (advance_owner TEXT, advance_stamp INTEGER, shard_tag INTEGER, segment_id TEXT, msg_count INTEGER, crc32 INTEGER, status TEXT, PRIMARY KEY (advance_owner, advance_stamp))`
- [ ] 1.2 Add `insertSegmentOpen(db, advanceOwner, advanceStamp, shardTag)` — `INSERT OR IGNORE` with `status='open'`
- [ ] 1.3 Add `updateSegmentOver(db, advanceOwner, advanceStamp)` — `UPDATE ... SET status='over'` (no-op if row missing via `WHERE` match)
- [ ] 1.4 Add `updateSegmentResolved(db, advanceOwner, advanceStamp, segmentId, msgCount, crc32)` — sets `segment_id`, `msg_count`, `crc32`, `status='resolved'`
- [ ] 1.5 Add `listSegments(db, limit = 500)` — `SELECT * FROM segment_registry ORDER BY advance_stamp DESC LIMIT ?`
- [ ] 1.6 Add `computeUriCrc(uris: string[])` helper — for each URI string calls `CRC32(uri)` and sums the results; use `zlib.crc32` (Node ≥22) with a pure-JS fallback; returns a 64-bit-safe JS number (sum of unsigned 32-bit values)

## 2. StorageTask Integration

- [ ] 2.1 Call `createSegmentRegistryTable(db)` inside `createHistoryTables` in `lib/sqlite/history.ts`, after the `event_history_*` DDL — same `CREATE TABLE IF NOT EXISTS` pattern, idempotent across multiple realm calls
- [ ] 2.2 In the `BEGIN_ADVANCE_SEGMENT` handler in `StorageTask`, call `insertSegmentOpen(db, args.advanceOwner, args.advanceStamp, args.shardTag)`
- [ ] 2.3 In the `ADVANCE_SEGMENT_OVER` handler in `StorageTask`, call `updateSegmentOver(db, body.advanceOwner, body.advanceStamp)`
- [ ] 2.4 In `dbSaveSegment`, inside the existing `BEGIN TRANSACTION` / `COMMIT` block, after all history inserts, call `updateSegmentResolved(...)` — `msgCount` from `historyBuffer.count()`, `crc32` from `computeUriCrc(historyBuffer.getContent().map(e => restoreUri(e.uri)))`

## 3. Admin RPC

- [ ] 3.1 Add `AdminEvent.SEGMENT_LIST = 'fox.admin.segment.list'` to the `AdminEvent` namespace in `lib/masterfree/hyper.h.ts`
- [ ] 3.2 Add `AdminSegmentListResponse = { segments: SegmentRecord[] }` and `SegmentRecord` type to `hyper.h.ts`
- [ ] 3.3 Register `fox.admin.segment.list` handler in `AdminApiServer` — calls `listSegments(this.db)` and returns `{ segments }`

## 4. foxctl Command

- [ ] 4.1 Add `foxctl segment list` sub-command: calls `fox.admin.segment.list`, displays ASCII table with columns `advance_owner | advance_stamp | shard_tag | segment_id | msg_count | crc32 | status`; `--json` outputs raw array
- [ ] 4.2 Wire `segment` group into the foxctl dispatcher alongside `kv`, `schema`, `event`
- [ ] 4.3 Update foxctl help text to include `segment list`

## 5. Tests

- [ ] 5.1 Unit test: `computeUriCrc([])` returns `0`
- [ ] 5.2 Unit test: `computeUriCrc(['a.b', 'c.d'])` returns `CRC32('a.b') + CRC32('c.d')`
- [ ] 5.3 Integration test in `test/63.storage.ts` (or new `test/66.segment_registry.ts`): after `ADVANCE_SEGMENT_RESOLVED`, `segment_registry` has one row with correct `advance_owner`, `advance_stamp`, `shard_tag`, `msg_count=1`, `crc32` non-zero, `status='resolved'`
- [ ] 5.4 Integration test: `BEGIN_ADVANCE_SEGMENT` creates a row with `status='open'`; `ADVANCE_SEGMENT_OVER` transitions it to `'over'`

## 6. Build and Final Checks

- [ ] 6.1 Run `tsc --noEmit` — no TypeScript errors
- [ ] 6.2 Run `npm test` — full suite passes
