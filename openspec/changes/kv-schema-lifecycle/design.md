## Context

Schema registration and validation are handled in `message-schema-repository`. This change focuses on managing the complete lifecycle of storage projections: activation (backfill from history), deactivation (stop accepting writes), reactivation, removal (cleanup), and schema replacement scenarios.

The system needs explicit commands and state management to ensure safe transitions, prevent data loss, and support schema evolution without automatic migration.

## Goals / Non-Goals

**Goals:**
- Define a formal state machine for storage records (Inactive, Refreshing, Online, deactivated).
- Implement backfill activation: read historical messages matching the schema pattern, validate, populate the generated table.
- Implement deactivation: stop accepting new writes while preserving the table and record.
- Implement reactivation: resume syncing from history after deactivation.
- Implement removal: drop generated table and delete storage record (cleanup).
- Support schema replacement: register new schema, activate new storage, deactivate old, remove old.
- Add timeout/expiry mechanisms to prevent indefinite waits during activation.
- Ensure all operations are explicit commands (no automatic triggers).

**Non-Goals:**
- Automatic data migration between old and new tables.
- Automatic schema versioning or deprecation.
- Live replication or dual-write during transitions.

## Decisions

### 1. Storage State Machine

Storage records transition through the following states:

```
Inactive ──────────────────> Refreshing ──────────────> Online
  ↑                                                         ↓
  └────────────────────────────── deactivated ◄───────────┘
                                       ↓
                                     (remove)
                                       ↓
                                     (deleted)
```

**State Definitions:**

- **Inactive**: Storage is registered, generated table exists and is empty, no syncing in progress. No writes to the table. This is the initial state after registration.
- **Refreshing**: Backfill is in progress. The system is reading historical messages matching the schema pattern from committed storage, validating them against the schema, and populating the generated table. New live messages matching the pattern are queued but not yet written.
- **Online**: Backfill completed, table is synced to present time. The system accepts new messages matching the schema pattern, validates them, and writes to the table in real-time.
- **deactivated**: Storage has been stopped. No new writes are accepted. The table and storage record remain intact, and may be reactivated or removed.

### 2. Activation Flow (Inactive → Refreshing → Online)

**Trigger:** User sends `Activate` command with storage name.

**Process:**

1. **Validation Phase**:
   - Verify storage exists and is in Inactive state.
   - Fetch linked schema by `schema_id`.
   - Verify generated table exists and is empty (or clear it if necessary).

2. **Backfill Phase** (Refreshing state):
   - Set storage status to Refreshing, record `started_at` timestamp.
   - Query the committed history/ledger for all messages matching the schema's URL pattern.
   - For each historical message:
     - Extract URL-derived primary key fields by position matching against `*` wildcards.
     - Merge URL values with body payload (URL values take precedence).
     - Validate merged payload against schema (types, required fields).
     - If valid, insert/upsert into the generated table.
     - If invalid, log error and skip (or log to `last_error` and pause).
   - Update `current_position` as backfill progresses.

3. **Completion Phase** (Online state):
   - Once backfill reaches the present time, set storage status to Online.
   - From this point forward, new messages matching the schema pattern are validated and written to the table immediately.

**Timeout**: If backfill does not complete within a configured timeout (e.g., 60s for small datasets, configurable), set status to Failed and store error in `last_error`.

**Failure Handling**: If validation errors occur, pause backfill, log to `last_error`, and wait for user intervention. Reactivate to retry.

### 3. Deactivation Flow (Online/Refreshing → deactivated)

**Trigger:** User sends `Deactivate` command with storage name.

**Process:**

1. Verify storage exists and is in Online or Refreshing state.
2. Set storage status to deactivated.
3. Stop accepting new writes to the generated table.
4. Keep the table and storage record intact (no deletion).
5. Clear `last_error` if present.

**Effect**: The table becomes read-only from this point. New messages matching the schema pattern are not written.

### 4. Reactivation Flow (deactivated → Refreshing → Online)

**Trigger:** User sends `Reactivate` command with storage name.

**Process:**

1. Verify storage exists and is in deactivated state.
2. Execute the same Activation Flow (backfill from history, transition to Online).
3. **Option A (Resync)**: Clear the table before resyncing (safe for schema changes).
4. **Option B (Resume)**: Resume from the last recorded position (if tracking is accurate).

**Recommendation**: For the initial implementation, always resync (Option A) to ensure correctness. Implement position tracking as an optimization later.

### 5. Removal Flow (deactivated → deleted)

**Trigger:** User sends `Remove` command with storage name.

**Process:**

1. Verify storage exists and is in deactivated state.
2. Execute `DROP TABLE data_<realmName>_<hash>` to remove the generated table.
3. Delete the storage record from `kv_storage_<realmName>`.
4. Storage is now fully removed.

**Precondition**: Only deactivated storage can be removed. This prevents accidental deletion of active projections.

### 6. Schema Replacement Scenario

To replace an existing schema:

**Sequence:**

1. **Register new schema variant** (via `message-schema-repository`):
   - Create new immutable schema with new `schema_id` and generated `data_table`.
   - Return new schema_id.

2. **Register new storage**:
   - Create new storage record pointing to the new schema.
   - Status: Inactive.

3. **Activate new storage** (this change):
   - Run activation (backfill from history).
   - Status transitions: Inactive → Refreshing → Online.

4. **Deactivate old storage** (this change):
   - Stop accepting writes to the old projection.
   - Status: deactivated.

5. **Remove old storage** (this change):
   - Drop the old generated table.
   - Delete the old storage record.

**No automatic transition** — all steps are explicit commands.

### 7. Error Handling and Retries

**Backfill Failure**: If validation fails on a historical message:
- Log the error with message details.
- Optionally stop backfill and wait for user decision (pause → investigate → reactivate).
- Or skip invalid messages and log to a "dead letter" log.

**Timeout**: If activation exceeds the configured timeout:
- Set storage status to Failed.
- Store descriptive error in `last_error`.
- User can investigate, fix underlying issues, and reactivate.

**Quorum Loss**: If a multi-node cluster loses quorum during activation:
- Pause backfill.
- Store error in `last_error`.
- Wait for cluster to recover or user intervention.

### 8. Backward Compatibility

- Existing storage records remain unaffected.
- New activation/deactivation/removal commands only affect storage records that are transitioned via these commands.
- Schemas remain immutable; no existing schema is modified by this change.

## Risks / Trade-offs

- **Backfill Time** — Syncing from full history can be slow on large datasets. Mitigation: Implement position tracking and partial resync for future optimization.
- **Table Inconsistency** — If backfill fails midway, the table may be partially populated. Mitigation: Clear table on reactivation or track high-water mark and resume.
- **Resource Usage** — Active backfill consumes CPU/IO. Mitigation: Rate-limit backfill or run during off-peak windows.
- **Timeout Calibration** — Too short (false failures), too long (blocks operators). Mitigation: Make timeout configurable per deployment.
