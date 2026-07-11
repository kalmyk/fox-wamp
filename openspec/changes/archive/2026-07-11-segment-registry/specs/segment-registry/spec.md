## ADDED Requirements

### Requirement: Segment registry table exists on each storage node
The storage node SHALL maintain a `segment_registry` SQLite table. The table SHALL be created inside `createHistoryTables` in `lib/sqlite/history.ts`, alongside the `event_history_*` table, using `CREATE TABLE IF NOT EXISTS`. The table SHALL have columns: `advance_owner TEXT`, `advance_stamp INTEGER`, `shard_tag INTEGER`, `segment_id TEXT`, `msg_count INTEGER`, `crc32 INTEGER`, `status TEXT`, with `(advance_owner, advance_stamp)` as the primary key.

#### Scenario: Table created on first realm initialisation
- **WHEN** `ensureRealm` is called for the first time (on any realm)
- **THEN** the `segment_registry` table SHALL exist (created if absent, unchanged if present, regardless of subsequent realm calls)

---

### Requirement: Row inserted on BEGIN_ADVANCE_SEGMENT
When the storage node receives `BEGIN_ADVANCE_SEGMENT`, it SHALL insert a row with `advance_owner`, `advance_stamp`, `shard_tag`, and `status='open'`. `segment_id`, `msg_count`, and `crc32` SHALL be NULL at this point.

#### Scenario: New segment opens
- **WHEN** `BEGIN_ADVANCE_SEGMENT` is received with `advanceOwner='E1'`, `advanceStamp=1000`, `shardTag=42`
- **THEN** a row with `advance_owner='E1'`, `advance_stamp=1000`, `shard_tag=42`, `status='open'` SHALL exist in `segment_registry`

#### Scenario: Duplicate BEGIN is ignored
- **WHEN** `BEGIN_ADVANCE_SEGMENT` arrives for an `(advanceOwner, advanceStamp)` pair that already has a row
- **THEN** the existing row SHALL not be overwritten (`INSERT OR IGNORE`)

---

### Requirement: Row status updated to 'over' on ADVANCE_SEGMENT_OVER
When the storage node receives `ADVANCE_SEGMENT_OVER`, it SHALL update the matching row's `status` to `'over'`.

#### Scenario: Segment signals completion
- **WHEN** `ADVANCE_SEGMENT_OVER` is received for `(advanceOwner, advanceStamp)`
- **THEN** the row's `status` SHALL be `'over'`

#### Scenario: OVER arrives before BEGIN
- **WHEN** `ADVANCE_SEGMENT_OVER` arrives for a pair with no existing row
- **THEN** no error SHALL be raised (`UPDATE OR IGNORE`)

---

### Requirement: Row finalised on ADVANCE_SEGMENT_RESOLVED
Inside the same database transaction as the event history inserts, the storage node SHALL update the matching row with `segment_id`, `msg_count` (number of messages in the segment), `crc32` (CRC-32 of all message bodies concatenated in offset order), and `status='resolved'`.

#### Scenario: Segment committed successfully
- **WHEN** `ADVANCE_SEGMENT_RESOLVED` is processed and the segment contains N messages
- **THEN** the row SHALL have `segment_id` set to the resolved segment string, `msg_count=N`, `crc32` set to a non-null integer, and `status='resolved'`
- **THEN** the update SHALL be committed in the same transaction as the `event_history_*` inserts

#### Scenario: CRC-32 summed over per-event URIs
- **WHEN** a segment has messages with URIs U1, U2, U3 (in commit order)
- **THEN** `crc32` SHALL equal `CRC32(restoreUri(U1)) + CRC32(restoreUri(U2)) + CRC32(restoreUri(U3))` where `restoreUri` produces the canonical dot-separated string (the same value stored in `msg_uri`)

#### Scenario: Empty segment (zero messages)
- **WHEN** `ADVANCE_SEGMENT_RESOLVED` arrives for a segment with no `KEEP_ADVANCE_HISTORY` messages
- **THEN** `msg_count=0` and `crc32=0` SHALL be stored

---

### Requirement: foxctl segment list command
`foxctl` SHALL provide a `segment list` sub-command that calls `fox.admin.segment.list` and displays results. Default output SHALL be an ASCII table with columns `advance_owner | advance_stamp | shard_tag | segment_id | msg_count | crc32 | status`. `--json` SHALL output the raw JSON array.

#### Scenario: Table output
- **WHEN** `foxctl --realm <realm> segment list` is run against a node with committed segments
- **THEN** each row in `segment_registry` SHALL appear as one line in the table

#### Scenario: JSON output
- **WHEN** `foxctl --realm <realm> segment list --json` is run
- **THEN** stdout SHALL contain a single-line JSON array of segment objects

---

### Requirement: fox.admin.segment.list admin RPC
The `AdminApiServer` SHALL register a `fox.admin.segment.list` handler that queries `segment_registry` and returns all rows ordered by `advance_stamp DESC`, limited to the most recent 500 rows.

#### Scenario: RPC returns segment rows
- **WHEN** `fox.admin.segment.list` is called
- **THEN** the response SHALL contain a `segments` array of objects with fields matching the table columns

#### Scenario: Empty table returns empty array
- **WHEN** `fox.admin.segment.list` is called and `segment_registry` has no rows
- **THEN** the response SHALL be `{ segments: [] }`
