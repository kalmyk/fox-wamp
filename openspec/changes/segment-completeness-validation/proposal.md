## Why

A storage node commits whatever it happened to receive for an advance segment — there is no check that what it received matches what the entry node actually sent over `KEEP_ADVANCE_HISTORY`. `BODY_ADVANCE_SEGMENT_OVER` already carries a `totalEvents` count from the entry node's own in-memory segment, but nothing on the storage side ever reads or compares it. A shard-routing bug, a dropped or duplicated `KEEP_ADVANCE_HISTORY` publish, or corruption in transit would silently commit an incomplete or wrong segment, and nothing today would notice.

## What Changes

- Extend `BODY_ADVANCE_SEGMENT_OVER` with a `totalCrc32: number` field, computed by the entry node from the same `CRC32(restoreUri(uri))`-sum formula the storage node already uses (`computeUriCrc` in `lib/sqlite/segment_registry.ts`), applied to the `ActorPush` entries held in its `HistorySegment` at the point `ADVANCE_SEGMENT_OVER` is emitted.
- On commit (`EventStorageTask.dbSaveSegment` in `lib/masterfree/storage.ts`), after the existing per-realm `segment_registry_<realm>` rows are upserted, sum the actual `msg_count`/`crc32` across all realms committed for that `(advanceOwner, advanceStamp)` and compare against the entry-reported `totalEvents`/`totalCrc32` carried on the `ADVANCE_SEGMENT_OVER` message.
- Record the comparison outcome (match / mismatch, expected vs. actual counts) in a new per-shard-segment record, separate from the existing per-realm `segment_registry_<realm>` tables (the entry-side totals are realm-agnostic, so they don't fit cleanly into a per-realm row).
- On mismatch, log an error with the expected vs. actual values; expose the outcome for inspection via the existing `fox.admin.segment.list` surface or a small addition to it.
- This is a passive integrity check only — no retry, replay, or correction of an incomplete segment is introduced. Detecting and surfacing the problem is in scope; automated recovery is not.

## Capabilities

### New Capabilities
- `segment-completeness-validation`: comparison of entry-reported segment totals (event count, CRC-32) against what the storage node actually committed for that advance segment, plus surfacing of any mismatch.

### Modified Capabilities
(none — this adds a new field to the internal `BODY_ADVANCE_SEGMENT_OVER` protocol message and a new validation record; it does not change any documented requirement of the existing `segment-registry` capability, whose per-realm table and requirements are untouched)

## Impact

- `lib/masterfree/hyper.h.ts`: add `totalCrc32: number` to `BODY_ADVANCE_SEGMENT_OVER`.
- `lib/masterfree/netengine.ts`: compute `totalCrc32` from `HistorySegment`'s `ActorPush` entries when emitting `ADVANCE_SEGMENT_OVER` (both the normal-completion and failed-segment paths that currently set `totalEvents`).
- `lib/masterfree/storage.ts`: capture the entry-reported `totalEvents`/`totalCrc32` when `ADVANCE_SEGMENT_OVER` is received; compare against actual committed totals at the end of `dbSaveSegment`.
- `lib/sqlite/segment_registry.ts` (or a new sibling module): storage/query for the new per-shard-segment validation record; reuse of `computeUriCrc`'s formula on the entry side.
- `lib/masterfree/admin_api.ts`: extend `fox.admin.segment.list` response (or add a field) to surface validation outcome.
- Testing: unit test for entry-side CRC computation parity with storage-side, integration test for a matching segment and for an injected mismatch.
