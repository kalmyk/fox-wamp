## Context

An advance segment's lifecycle today: the entry node accumulates `ActorPush` events into an in-memory `HistorySegment` (`lib/masterfree/netengine.ts`), publishes each as `KEEP_ADVANCE_HISTORY.<shardTag>`, then emits `ADVANCE_SEGMENT_OVER` carrying `totalEvents: this.curSegment.size()` (`netengine.ts:176`). The owning storage node (`EventStorageTask` in `lib/masterfree/storage.ts`) receives `KEEP_ADVANCE_HISTORY` independently and accumulates its own `HistoryBuffer`; on `ADVANCE_SEGMENT_OVER` it inserts per-realm `segment_registry_<realm>` rows with `status='over'` (`storage.ts:77-95`); on `ADVANCE_SEGMENT_RESOLVED` it commits the buffer (`dbSaveSegment`, `storage.ts:169-207`), computing real `msg_count`/`crc32` per realm via `computeUriCrc` (`lib/sqlite/segment_registry.ts`).

`body.totalEvents` is received by the storage node's `ADVANCE_SEGMENT_OVER` handler but never read. There is no cross-check today that the entry node's count of what it sent matches the storage node's count of what it received and committed. `segment-registry` (archived 2026-07-11) already gives per-realm integrity data (msg_count, crc32) on the storage side; this change adds the other half — an entry-side total to compare it against.

Shard ownership is single-node (no replication, confirmed during exploration), so this is not a replica-reconciliation problem. It is a two-party (sender vs. receiver) completeness check for one already-existing transport path.

## Goals / Non-Goals

**Goals:**
- Give the entry node a way to report what it actually sent for a segment (count + CRC-32), using the same CRC formula the storage side already uses.
- Have the storage node compare its actually-committed totals (summed across all realms of that segment) against the entry-reported totals, and record match/mismatch.
- Surface a mismatch (log + admin-visible), without touching or reprocessing already-committed data.

**Non-Goals:**
- Shard/segment replication or cross-replica reconciliation — no replicas exist today (see proposal.md Why/Impact).
- Automatic recovery, retry, or replay of a segment found to be incomplete. Detection only.
- Changing the existing per-realm `segment_registry_<realm>` schema or its documented requirements.
- Validating individual event payload integrity beyond what CRC-32-of-URI already covers (this mirrors the existing `segment-registry` CRC scope, not a new payload-hashing scheme).

## Decisions

### D1: New global `segment_validation` table, not columns on `segment_registry_<realm>`
**Decision:** Add one table, `segment_validation`, keyed by `(advance_owner, advance_stamp)` — not per-realm — with columns `shard_tag`, `expected_msg_count`, `expected_crc32`, `actual_msg_count`, `actual_crc32`, `status` (`'pending' | 'match' | 'mismatch' | 'unvalidated'`).
**Rationale:** The entry node's total is realm-agnostic (a `HistorySegment` mixes events for whatever realms happened to publish into that shard/segment); it doesn't decompose into a specific realm's expected count without teaching the entry node about realm-level segment grouping it doesn't otherwise need. A single table keyed by the same `(advance_owner, advance_stamp)` pair `segment_registry` already uses keeps the two concerns (per-realm committed detail vs. whole-segment completeness) separate and avoids adding nullable "expected" columns to N per-realm tables.
**Alternative considered:** Add `expected_msg_count`/`expected_crc32` to `segment_registry_<realm>`, splitting the entry's total across realms proportionally or duplicating it per realm row. Rejected — a duplicated or approximated per-realm "expected" value is misleading, and the existing `segment-registry` capability's documented requirements would have to change (the proposal explicitly avoids that).

### D2: Entry-side CRC computed with the same helper the storage side uses
**Decision:** Generalize `computeUriCrc` in `lib/sqlite/segment_registry.ts` to accept `{ uri: string[] }[]` instead of `BODY_KEEP_ADVANCE_HISTORY[]` specifically. `netengine.ts` maps its `HistorySegment`'s `ActorPush` entries (via `getUri()`) into that shape and calls the same function when building the `ADVANCE_SEGMENT_OVER` body.
**Rationale:** `lib/masterfree/storage.ts` already imports from `lib/sqlite/segment_registry.ts` (existing layering), so `netengine.ts` doing the same is consistent, not a new dependency direction. Reusing one function guarantees the entry and storage sides can never compute CRC-32 differently by accident (e.g. a future change to `restoreUri` only touching one side).
**Alternative considered:** Duplicate the sum-of-CRC32 formula in `netengine.ts`. Rejected — two copies of the same formula are exactly the kind of drift this feature exists to catch elsewhere.

### D3: Expected values captured at `ADVANCE_SEGMENT_OVER`, compared at commit
**Decision:** When `ADVANCE_SEGMENT_OVER` is received, upsert a `segment_validation` row with `expected_msg_count = body.totalEvents`, `expected_crc32 = body.totalCrc32`, `status = 'pending'` — alongside the existing per-realm `insertSegmentOver` calls (`storage.ts:85-94`). Inside `dbSaveSegment`, after the existing per-realm loop already computes each realm's `msgCount`/`crc32` via `computeUriCrc`, sum those across realms and upsert `actual_msg_count`/`actual_crc32` plus the derived `status` (`'match'` if both totals agree, else `'mismatch'`) into the same `segment_validation` row, in the same transaction as the `segment_registry_<realm>` upserts.
**Rationale:** Mirrors the existing over→resolved lifecycle exactly; no new message round-trip is needed since both totals are already computed at points that already exist.

### D4: Race handling mirrors `segment-registry`'s existing pattern
**Decision:** If `ADVANCE_SEGMENT_RESOLVED` commits before the `ADVANCE_SEGMENT_OVER` row exists, `dbSaveSegment` inserts a fresh `segment_validation` row with `actual_*` populated and `expected_msg_count`/`expected_crc32` left `NULL`, `status = 'unvalidated'`. If `ADVANCE_SEGMENT_OVER` then arrives (should not happen since OVER precedes RESOLVED in the protocol, but mirrors the existing documented race in `segment-registry`), it is an `INSERT OR IGNORE` no-op against the already-resolved row — expected values are simply never backfilled in that ordering, and the row stays `'unvalidated'`. This is an accepted edge case, not a target state.
**Rationale:** Directly reuses the race-handling shape already specified for `segment_registry` rather than inventing new ordering guarantees.

### D5: Mismatch is logged and recorded, never blocks commit
**Decision:** A mismatch does not roll back the transaction, does not block `SEGMENT_COMMITTED` emission, and does not retry anything. It is a `console.error` with expected vs. actual values plus the persisted `status='mismatch'` row, visible later via `fox.admin.segment.list`.
**Rationale:** The proposal is explicit that this is detection, not correction; blocking commit on a currently-unactionable mismatch would turn a monitoring signal into an availability risk.

### D6: Surface via existing `fox.admin.segment.list`
**Decision:** Extend `AdminSegmentListResponse`'s `SegmentRecord` with `validationStatus: string | null` (and optionally `expectedMsgCount`/`expectedCrc32`), populated by joining `segment_registry_<realm>` rows to `segment_validation` on `(advance_owner, advance_stamp)` in the existing handler.
**Rationale:** Reuses the one admin surface that already exists for segment inspection instead of adding a new RPC/CLI command.

## Risks / Trade-offs

- **[Risk] Sum-of-CRC32 cannot detect a swap of one dropped event for one duplicated event with an equal CRC-32 contribution** → **Mitigation:** this is an existing, accepted limitation of the sum-of-CRC32 approach already used by `segment-registry`; not a new weakness introduced here, and `expected_msg_count`/`actual_msg_count` still catches any count mismatch even when CRC-32 sums coincidentally agree.
- **[Risk] `segment_validation` row can be left `status='unvalidated'` forever if `ADVANCE_SEGMENT_OVER` is lost entirely** → **Mitigation:** acceptable — an `'unvalidated'` row is itself visible via the admin surface and distinguishable from `'match'`/`'mismatch'`, so it doesn't silently look fine.
- **[Risk] Extra `totalCrc32` computation on the entry node's hot path (segment close)** → **Mitigation:** bounded by segment size (same order of work the storage side already does per segment on every commit); no new per-event cost, just a one-time pass at segment close.

## Migration Plan

- Purely additive: new field on an internal protocol message (`BODY_ADVANCE_SEGMENT_OVER.totalCrc32`), new table (`segment_validation`), extended admin response field. No changes to `segment_registry_<realm>` schema or `event_history_<realm>`.
- `computeUriCrc`'s signature broadens (from a specific type to `{ uri: string[] }[]`) — a compatible, non-breaking widening since `BODY_KEEP_ADVANCE_HISTORY` already structurally satisfies `{ uri: string[] }`.
- No rollback complexity beyond reverting; `segment_validation` rows are purely observational and never read by any commit-path logic that would change committed data.

## Open Questions

- Should `expectedMsgCount`/`expectedCrc32` also be exposed via `fox.admin.segment.list`, or is `validationStatus` alone sufficient for the first version? Leaning toward including both for debuggability, but deferring to whoever implements tasks.md if response payload size becomes a concern.
