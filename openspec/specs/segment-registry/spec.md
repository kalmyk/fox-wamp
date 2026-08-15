# segment-registry Specification

## Purpose

Each storage node maintains a `segment_registry_<realm>` SQLite table that tracks the lifecycle of every advance segment it processes. The table is used for observability (`foxctl segment list`), integrity verification (CRC-32), and as an index for future history-fetch operations.

## Requirements

### Requirement: Segment registry table exists per realm on each storage node

The storage node SHALL maintain a `segment_registry_<realm>` SQLite table per realm. The table SHALL be created inside `createHistoryTables` in `lib/sqlite/history.ts`, alongside the `event_history_<realm>` table, using `CREATE TABLE IF NOT EXISTS`. The table SHALL have columns: `advance_owner TEXT`, `advance_stamp INTEGER`, `shard_tag INTEGER`, `segment_id TEXT`, `msg_count INTEGER`, `crc32 INTEGER`, `status TEXT`, with `(advance_owner, advance_stamp)` as the primary key.

#### Scenario: Table created on first realm initialisation

- **WHEN** `ensureRealm` is called for the first time for a given realm
- **THEN** `segment_registry_<realm>` SHALL exist (created if absent, unchanged if present, regardless of subsequent calls)

---

### Requirement: Row inserted on ADVANCE_SEGMENT_OVER

When the storage node receives `ADVANCE_SEGMENT_OVER` and has a buffer for that segment (i.e., it owns the shard), it SHALL insert one row per realm that has events in that segment, with `advance_owner`, `advance_stamp`, `shard_tag`, and `status='over'`. `segment_id`, `msg_count`, and `crc32` SHALL be NULL at this point. The insert SHALL use `INSERT OR IGNORE` to be idempotent.

#### Scenario: Segment signals over

- **WHEN** `ADVANCE_SEGMENT_OVER` is received for `(advanceOwner, advanceStamp)` and the buffer has events for realm `r`
- **THEN** a row with `advance_owner`, `advance_stamp`, `shard_tag`, `status='over'` SHALL be inserted into `segment_registry_r`

#### Scenario: Duplicate OVER is ignored

- **WHEN** `ADVANCE_SEGMENT_OVER` arrives for a pair that already has a row
- **THEN** the existing row SHALL not be overwritten (`INSERT OR IGNORE`)

---

### Requirement: Row finalised on ADVANCE_SEGMENT_RESOLVED

Inside the same database transaction as the event history inserts, the storage node SHALL upsert a row with `segment_id`, `msg_count` (number of messages in the segment for that realm), `crc32` (sum of CRC-32 of each event's canonical URI), `shard_tag`, and `status='resolved'`. The UPSERT ensures the row is created even if `ADVANCE_SEGMENT_OVER` has not yet been processed.

#### Scenario: Segment committed successfully

- **WHEN** `ADVANCE_SEGMENT_RESOLVED` is processed and the segment contains N messages for realm `r`
- **THEN** the row in `segment_registry_r` SHALL have `segment_id` set to the resolved segment string, `msg_count=N`, `crc32` set to a non-null integer, and `status='resolved'`
- **AND** the upsert SHALL be committed in the same transaction as the `event_history_<realm>` inserts

#### Scenario: RESOLVED arrives before OVER row exists (race)

- **WHEN** `ADVANCE_SEGMENT_RESOLVED` is processed before `ADVANCE_SEGMENT_OVER`'s async insertion completes
- **THEN** a new row SHALL be inserted with full data and `status='resolved'`
- **AND** the subsequent `INSERT OR IGNORE` from the OVER handler SHALL be silently ignored

#### Scenario: CRC-32 summed over per-event URIs

- **WHEN** a segment has messages with URIs U1, U2, U3 (in commit order)
- **THEN** `crc32` SHALL equal `CRC32(restoreUri(U1)) + CRC32(restoreUri(U2)) + CRC32(restoreUri(U3))` using Node.js `zlib.crc32` (available in Node 20+)

#### Scenario: Empty segment (zero messages)

- **WHEN** `ADVANCE_SEGMENT_RESOLVED` arrives for a segment with no `KEEP_ADVANCE_HISTORY` messages on this node
- **THEN** no row SHALL be written (buffer is absent; nothing to upsert)

---

### Requirement: fox.admin.segment.list admin RPC

The `AdminApiServer` SHALL register a `fox.admin.segment.list` handler that queries `segment_registry_<realm>` and returns all rows ordered by `advance_stamp DESC`, limited to the most recent 500 rows.

#### Scenario: RPC returns segment rows

- **WHEN** `fox.admin.segment.list` is called on realm `r`
- **THEN** the response SHALL contain a `segments` array of objects with fields: `advanceOwner`, `advanceStamp`, `shardTag`, `segmentId`, `msgCount`, `crc32`, `status`

#### Scenario: Empty table returns empty array

- **WHEN** `fox.admin.segment.list` is called and `segment_registry_<realm>` has no rows
- **THEN** the response SHALL be `{ segments: [] }`

---

### Requirement: foxctl segment list command

`foxctl` SHALL provide a `segment list` sub-command that calls `fox.admin.segment.list` and displays results. Default output SHALL be an ASCII table with columns `advance_owner | advance_stamp | shard_tag | segment_id | msg_count | crc32 | status`. `--json` SHALL output the raw JSON array.

#### Scenario: Table output

- **WHEN** `foxctl --realm <realm> segment list` is run against a node with committed segments
- **THEN** each row in `segment_registry_<realm>` SHALL appear as one line in the table

#### Scenario: JSON output

- **WHEN** `foxctl --realm <realm> segment list --json` is run
- **THEN** stdout SHALL contain a single-line JSON array of segment objects
