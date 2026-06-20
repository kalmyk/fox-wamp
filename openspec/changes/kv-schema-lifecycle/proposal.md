## Why

Schemas are immutable and independent of storage. To modify a schema, you must register a new schema variant, activate a new storage projection, deactivate the old one, and clean up the obsolete generated table. The system needs explicit commands and state management to handle this lifecycle safely and clearly.

Currently, storage records have limited state semantics. They need to support:
- **Inactive** — registered but not yet synced
- **Refreshing** — actively syncing from history
- **Online** — synced, accepting live writes
- **deactivated** — stopped, awaiting reactivation or removal

Each transition requires clear command contracts and validation rules.

## What Changes

- Add formal storage state machine with four states: Inactive, Refreshing, Online, deactivated.
- Add **Activate** command: transition Inactive → Refreshing → Online by reading historical messages matching the schema pattern, validating them, populating the generated table, then accepting live writes.
- Add **Deactivate** command: transition Online/Refreshing → deactivated, stop accepting new writes to the table.
- Add **Reactivate** command: transition deactivated → Refreshing → Online, resync from history.
- Add **Remove** command: transition deactivated → deleted, drop generated table and remove storage record.
- Add **Register New Schema Variant** as part of schema replacement flow: create new immutable schema, generate new table, return new schema_id.

## Capabilities

### New Capabilities

- `storage-activation`: Backfill storage from historical messages, transition to online state.
- `storage-deactivation`: Stop accepting writes to a storage, transition to deactivated state.
- `storage-reactivation`: Resume syncing from history, transition deactivated storage back to online.
- `storage-removal`: Clean up deactivated storage by dropping table and removing record.
- `schema-replacement`: Register new schema variant and manage transition from old to new projection.

## Impact

- Storage registry table gains formal state machine semantics.
- New command handlers for activate, deactivate, reactivate, remove operations.
- Backfill/activation logic must read from committed history, validate against linked schema, and populate generated table.
- Schema repository may add methods to retrieve schema by ID for lookup during backfill.
- Future `foxctl` commands need schema and storage lifecycle management.

## State Machine

```
┌──────────┐
│ Inactive │  (storage registered, empty table, no sync)
└────┬─────┘
     │
     │ Activate
     ↓
┌──────────────┐
│  Refreshing  │  (syncing from history)
└────┬─────────┘
     │
     │ (sync complete)
     ↓
┌────────┐
│ Online │  (synced, accepting live writes)
└────┬───┘
     │
     │ Deactivate
     ↓
┌──────────────┐
│ deactivated  │  (stopped, not accepting writes)
└────┬─────────┘
     │
     ├─ Reactivate ──→ Refreshing ──→ Online
     │
     └─ Remove ──→ (deleted)
```

## Activation Flow

**Trigger:** User sends `Activate` command with storage name.

**Process:**

1. Verify storage exists and is in Inactive state.
2. Fetch the linked schema (by `schema_id`).
3. Set storage status to Refreshing.
4. Start long-running backfill:
   - Query committed history for messages matching the schema's URL pattern.
   - For each message, validate payload against the schema.
   - Extract URL-derived primary key fields by position matching.
   - Merge URL values with body payload.
   - Validate merged payload (all required fields present, types correct).
   - Insert/upsert into the generated data table.
   - Track current position (segment/offset).
5. Once backfill completes, set storage status to Online.
6. From this point forward, new messages matching the schema pattern are validated and written to the table in real-time.

**Failure handling:** If validation fails during backfill, log error, store in `last_error`, and pause. User can investigate and reactivate.

## Deactivation Flow

**Trigger:** User sends `Deactivate` command with storage name.

**Process:**

1. Verify storage exists and is in Online or Refreshing state.
2. Set storage status to deactivated.
3. Stop accepting new writes to the table.
4. Keep the table and storage record intact (may be reactivated or removed later).

## Reactivation Flow

**Trigger:** User sends `Reactivate` command with storage name.

**Process:**

1. Verify storage exists and is in deactivated state.
2. Same as Activation Flow (backfill from history, transition Refreshing → Online).
3. (Optional: truncate table before resyncing, or resume from last position — clarify later).

## Removal (Cleanup) Flow

**Trigger:** User sends `Remove` command with storage name.

**Process:**

1. Verify storage exists and is in deactivated state.
2. Drop the generated data table (e.g., `DROP TABLE data_testrealm_xxxxx`).
3. Delete the storage record from `kv_storage_${realmName}`.
4. Storage is now gone.

## Schema Replacement Scenario

To replace an existing schema:

1. **Register new schema variant** — Create new immutable schema with new `schema_id` and generated `data_table`.
2. **Register new storage** — Create new storage record pointing to the new schema.
3. **Activate new storage** — Backfill and sync from history using the new schema.
4. **Deactivate old storage** — Stop writes to the old projection.
5. **Remove old storage** — Drop old table and clean up the record.

All operations are explicit commands; no automatic migration of data between old and new tables.

## Command Contracts

### Activate

**Input:**
```
storage_name: string (e.g., "customer_data")
```

**Output:**
```
{
  name: string,
  status: "Refreshing",
  started_at: integer (timestamp),
  current_position: null (will be set during backfill)
}
```

**Errors:**
- Storage not found
- Storage not in Inactive state
- Linked schema not found

---

### Deactivate

**Input:**
```
storage_name: string
```

**Output:**
```
{
  name: string,
  status: "deactivated"
}
```

**Errors:**
- Storage not found
- Storage not in Online or Refreshing state

---

### Reactivate

**Input:**
```
storage_name: string
```

**Output:**
```
{
  name: string,
  status: "Refreshing",
  started_at: integer (timestamp)
}
```

**Errors:**
- Storage not found
- Storage not in deactivated state
- Linked schema not found

---

### Remove

**Input:**
```
storage_name: string
```

**Output:**
```
{
  success: boolean
}
```

**Errors:**
- Storage not found
- Storage not in deactivated state
- Table drop failed

---

### Register New Schema Variant

**Input:**
```
{
  label: string,
  url_pattern: string (e.g., "customer.*"),
  schema: {
    properties: { ... },
    primary_key: [ ... ],
    ...
  }
}
```

**Output:**
```
{
  schema_id: string,
  label: string,
  url_pattern: string,
  data_table: string,
  status: "active",
  created_at: integer
}
```

**Errors:**
- Invalid schema body
- Wildcard count does not match primary_key count
- Schema generation failed
