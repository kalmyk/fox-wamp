## ADDED Requirements

### Requirement: Entry node reports segment totals on ADVANCE_SEGMENT_OVER
The entry node SHALL include `totalCrc32`, a CRC-32 checksum computed the same way `segment-registry` computes it (sum of `CRC32(restoreUri(uri))` over every event in the segment), alongside the existing `totalEvents` count when emitting `ADVANCE_SEGMENT_OVER`.

#### Scenario: Segment closes normally
- **WHEN** the entry node emits `ADVANCE_SEGMENT_OVER` for a completed segment
- **THEN** the message SHALL include `totalEvents` equal to the number of events accumulated in that segment
- **AND** SHALL include `totalCrc32` equal to the sum of `CRC32(restoreUri(uri))` over those same events, in the order they were added

#### Scenario: Segment closes on failure path
- **WHEN** the entry node emits `ADVANCE_SEGMENT_OVER` for a segment that failed to resolve and is being reported before retry
- **THEN** the message SHALL include `totalEvents` and `totalCrc32` computed the same way as the normal-completion path

### Requirement: Storage node records expected totals when segment closes
When the storage node receives `ADVANCE_SEGMENT_OVER` for a segment it owns (has a buffer for), it SHALL record the entry-reported `totalEvents` and `totalCrc32` as `expected_msg_count` and `expected_crc32` in a `segment_validation` row keyed by `(advance_owner, advance_stamp)`, with `status='pending'`.

#### Scenario: Expected totals recorded
- **WHEN** `ADVANCE_SEGMENT_OVER` is received for `(advanceOwner, advanceStamp)` with `totalEvents=N` and `totalCrc32=C`
- **AND** the storage node has a buffer for that segment
- **THEN** a `segment_validation` row SHALL exist with `expected_msg_count=N`, `expected_crc32=C`, `status='pending'`

#### Scenario: Storage node does not own the segment's shard
- **WHEN** `ADVANCE_SEGMENT_OVER` is received for `(advanceOwner, advanceStamp)` and the storage node has no buffer for that pair
- **THEN** no `segment_validation` row SHALL be written by that node

### Requirement: Storage node compares actual committed totals against expected totals
When the storage node commits a segment (`ADVANCE_SEGMENT_RESOLVED` processing), it SHALL sum the actual `msg_count` and `crc32` values across all realms committed for that `(advance_owner, advance_stamp)` and update the `segment_validation` row with `actual_msg_count`, `actual_crc32`, and a derived `status`: `'match'` if both actual totals equal the recorded expected totals, otherwise `'mismatch'`. The comparison SHALL happen in the same database transaction as the per-realm `segment_registry_<realm>` commit.

#### Scenario: Totals agree
- **WHEN** a segment commits with actual totals equal to the previously recorded expected totals
- **THEN** the `segment_validation` row SHALL have `status='match'`

#### Scenario: Totals disagree
- **WHEN** a segment commits with an actual `msg_count` or `crc32` different from the recorded expected values
- **THEN** the `segment_validation` row SHALL have `status='mismatch'`, retaining both the expected and actual values
- **AND** the storage node SHALL log an error including the expected and actual values
- **AND** the segment SHALL still be committed and `SEGMENT_COMMITTED` SHALL still be emitted — a mismatch SHALL NOT block or roll back the commit

#### Scenario: Commit happens before expected totals were recorded
- **WHEN** a segment commits and no `segment_validation` row with expected totals exists yet for that `(advance_owner, advance_stamp)`
- **THEN** a `segment_validation` row SHALL be created with `actual_msg_count` and `actual_crc32` populated, `expected_msg_count` and `expected_crc32` left `NULL`, and `status='unvalidated'`

### Requirement: Validation outcome visible via existing admin surface
The `fox.admin.segment.list` response SHALL include, for each segment row, the corresponding `segment_validation` outcome (`validationStatus`), joined by `(advance_owner, advance_stamp)`.

#### Scenario: Admin lists a validated segment
- **WHEN** `fox.admin.segment.list` is called and a returned segment has a corresponding `segment_validation` row
- **THEN** the returned segment object SHALL include `validationStatus` set to that row's `status`

#### Scenario: Admin lists a segment with no validation row
- **WHEN** `fox.admin.segment.list` is called and a returned segment has no corresponding `segment_validation` row
- **THEN** the returned segment object SHALL include `validationStatus: null`
