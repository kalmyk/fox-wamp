## 1. SQLite Helper Module

- [x] 1.1 Create `lib/sqlite/segment_registry.ts` with `createSegmentRegistryTable(db, realmName)` — `CREATE TABLE IF NOT EXISTS segment_registry_<realmName> (advance_owner TEXT, advance_stamp INTEGER, shard_tag INTEGER, segment_id TEXT, msg_count INTEGER, crc32 INTEGER, status TEXT, PRIMARY KEY (advance_owner, advance_stamp))`
- [x] 1.2 Add `insertSegmentOver(db, realmName, advanceOwner, advanceStamp, shardTag)` — `INSERT OR IGNORE` with `status='over'`
- [x] 1.3 Add `updateSegmentResolved(db, realmName, advanceOwner, advanceStamp, segmentId, msgCount, crc32)` — sets `segment_id`, `msg_count`, `crc32`, `status='resolved'`
- [x] 1.4 Add `listSegments(db, realmName, limit = 500)` — `SELECT * FROM segment_registry_<realmName> ORDER BY advance_stamp DESC LIMIT ?`
- [x] 1.5 Add `computeUriCrc(events: BODY_KEEP_ADVANCE_HISTORY[])` helper — `events.reduce((sum, e) => sum + crc32(restoreUri(e.uri)), 0)` using `zlib.crc32` (available in Node 20+); no fallback needed

## 2. StorageTask Integration

- [x] 2.1 Call `createSegmentRegistryTable(db, realmName)` inside `createHistoryTables` in `lib/sqlite/history.ts`, after the `event_history_*` DDL — same `CREATE TABLE IF NOT EXISTS` pattern, idempotent across multiple realm calls
- [x] 2.2 In the `ADVANCE_SEGMENT_OVER` handler in `EventStorageTask`: look up `bufferToWrite` for `body.advanceOwner + ':' + body.advanceStamp`; if no buffer skip (not our shard); group buffer events by realm; for each realm call `insertSegmentOver(db, realm, body.advanceOwner, body.advanceStamp, body.shardTag)`
- [x] 2.3 Extend `dbSaveSegment(historyBuffer, segment)` signature to `dbSaveSegment(historyBuffer, segment, advanceOwner, advanceStamp)` — pass the extra params from `commit_segment`; inside the existing `BEGIN TRANSACTION` / `COMMIT` block, after all history inserts, call `updateSegmentResolved(db, realm, advanceOwner, advanceStamp, segment, msgCount, crc32)` — `msgCount` from `historyBuffer.count()`, `crc32` from `computeUriCrc(historyBuffer.getContent())`

## 3. Admin RPC

- [x] 3.1 Add `AdminEvent.SEGMENT_LIST = 'fox.admin.segment.list'` to the `AdminEvent` namespace in `lib/masterfree/hyper.h.ts`
- [x] 3.2 Add `AdminSegmentListResponse = { segments: SegmentRecord[] }` and `SegmentRecord` type to `hyper.h.ts`
- [x] 3.3 Register `fox.admin.segment.list` handler in `AdminApiServer` — calls `listSegments(this.db)` and returns `{ segments }`

## 4. foxctl Command

- [x] 4.1 Add `foxctl segment list` sub-command: calls `fox.admin.segment.list`, displays ASCII table with columns `advance_owner | advance_stamp | shard_tag | segment_id | msg_count | crc32 | status`; `--json` outputs raw array
- [x] 4.2 Wire `segment` group into the foxctl dispatcher alongside `kv`, `schema`, `event`
- [x] 4.3 Update foxctl help text to include `segment list`

## 5. Tests

- [x] 5.1 Unit test: `computeUriCrc([])` returns `0`
- [x] 5.2 Unit test: `computeUriCrc(['a.b', 'c.d'])` returns `CRC32('a.b') + CRC32('c.d')`
- [x] 5.3 Integration test in `test/63.storage.ts` (or new `test/66.segment_registry.ts`): after `ADVANCE_SEGMENT_RESOLVED`, `segment_registry_<realm>` has one row with correct `advance_owner`, `advance_stamp`, `shard_tag`, `msg_count=1`, `crc32` non-zero, `status='resolved'`
- [x] 5.4 Integration test: after `ADVANCE_SEGMENT_OVER`, `segment_registry_<realm>` has a row with `status='over'`; after `ADVANCE_SEGMENT_RESOLVED` the same row transitions to `status='resolved'`

## 6. Build and Final Checks

- [x] 6.1 Run `tsc --noEmit` — no TypeScript errors
- [x] 6.2 Run `npm test` — full suite passes
