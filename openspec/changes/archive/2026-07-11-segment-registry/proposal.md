## Why

The cluster has no persistent record of which advance segments were processed, how many messages they contained, or whether their content is intact. A segment registry table gives operators and tooling a queryable audit trail — useful for debugging gaps, detecting data loss via CRC mismatch, and correlating shardTag with the segments written to each storage node.

## What Changes

- New SQLite table `segment_registry` on each storage node, written by `StorageTask`
- Row inserted on `BEGIN_ADVANCE_SEGMENT` (advanceStamp, advanceOwner)
- Row updated on `ADVANCE_SEGMENT_OVER` (shardTag recorded)
- Row finalised on `ADVANCE_SEGMENT_RESOLVED` (resolved segment ID, message count, CRC of all message bodies)
- New helper module `lib/sqlite/segment_registry.ts` for all DDL and DML
- `foxctl` gains `foxctl segment list` command to query the table

## Capabilities

### New Capabilities

- `segment-registry`: Persistent per-node table tracking each advance segment from open to resolved, with shardTag, message count, and CRC

### Modified Capabilities

<!-- none -->

## Impact

- `lib/masterfree/storage.ts` — `StorageTask` calls segment_registry helpers on the three segment lifecycle events
- `lib/sqlite/segment_registry.ts` — new file (DDL + insert/update helpers)
- `masterfree/ndb.ts` — no change needed (StorageTask constructor already receives the db)
- `lib/masterfree/admin_api.ts` — optional: expose segment list via `fox.admin.segment.list` RPC
- `bin/foxctl.ts` — new `segment list` command
- `test/63.storage.ts` — verify segment_registry rows after commit
