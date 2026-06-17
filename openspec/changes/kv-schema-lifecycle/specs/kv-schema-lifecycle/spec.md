# KV Schema Lifecycle Specification

## Overview

This specification defines the command contracts and state machine for managing storage projection lifecycles: activation (backfill), deactivation, reactivation, and removal.

## State Machine

```
Inactive ──Activate──> Refreshing ──(complete)──> Online
  ↑                                                   ↓
  └─────────────Deactivate─────────> deactivated ◄──┘
                                          ↓
                                       Remove
                                          ↓
                                      (deleted)
```

### State Descriptions

| State | Meaning | Writable | Can Transition To |
|-------|---------|----------|-------------------|
| Inactive | Registered, empty table, not syncing | No | Refreshing (Activate) |
| Refreshing | Syncing from history | No | Online (completion), deactivated (Deactivate), Failed (timeout) |
| Online | Synced, accepting live writes | Yes | deactivated (Deactivate) |
| deactivated | Stopped, not accepting writes | No | Refreshing (Reactivate), deleted (Remove) |
| Failed | Activation failed, awaiting retry | No | Refreshing (Reactivate) |

## Commands

### 1. Activate

**Purpose**: Begin backfill from history; transition storage from Inactive to Online.

**Input**:
```json
{
  "storage_name": "sqlite:realm1:customer.*",
  "timeout_ms": 60000
}
```

**Process**:
1. Verify storage is Inactive.
2. Fetch linked schema.
3. Set status to Refreshing, record started_at.
4. Read historical messages matching schema URL pattern.
5. For each message:
   - Extract URL primary keys by position matching.
   - Merge with body payload.
   - Validate against schema.
   - Upsert into generated table.
6. Update current_position as progress.
7. On completion: set status to Online.
8. On timeout: set status to Failed, store error in last_error.

**Output** (Success):
```json
{
  "storage_name": "sqlite:realm1:customer.*",
  "status": "Refreshing",
  "started_at": 1718664000000,
  "current_position": null
}
```

**Output** (Failure):
```json
{
  "error": "Activation timed out after 60000ms",
  "storage_name": "sqlite:realm1:customer.*",
  "status": "Failed"
}
```

**Errors**:
- Storage not found (404)
- Storage not in Inactive state (409)
- Schema not found (404)
- Table creation failed (500)
- Backfill timeout (504)

### 2. Deactivate

**Purpose**: Stop accepting writes to a storage; transition from Online/Refreshing to deactivated.

**Input**:
```json
{
  "storage_name": "sqlite:realm1:customer.*"
}
```

**Process**:
1. Verify storage is Online or Refreshing.
2. Set status to deactivated.
3. Stop accepting new writes.

**Output**:
```json
{
  "storage_name": "sqlite:realm1:customer.*",
  "status": "deactivated"
}
```

**Errors**:
- Storage not found (404)
- Storage not in Online/Refreshing state (409)

### 3. Reactivate

**Purpose**: Resume backfill; transition deactivated storage back to Online.

**Input**:
```json
{
  "storage_name": "sqlite:realm1:customer.*",
  "timeout_ms": 60000
}
```

**Process**:
1. Verify storage is deactivated.
2. Clear generated table (resync from history).
3. Execute Activate flow (same as Activate command).

**Output**: Same as Activate command.

**Errors**: Same as Activate command, plus:
- Storage not in deactivated state (409)

### 4. Remove

**Purpose**: Clean up deactivated storage; drop table and delete record.

**Input**:
```json
{
  "storage_name": "sqlite:realm1:customer.*"
}
```

**Process**:
1. Verify storage is deactivated.
2. Execute `DROP TABLE data_<realmName>_<hash>`.
3. Delete storage record from `kv_storage_<realmName>`.

**Output**:
```json
{
  "success": true,
  "storage_name": "sqlite:realm1:customer.*"
}
```

**Errors**:
- Storage not found (404)
- Storage not in deactivated state (409)
- Table drop failed (500)
- Record deletion failed (500)

## Backfill Algorithm

```
function backfill(storage, schema, timeoutMs):
  startTime = now()
  tableEmpty = confirm table is empty or clear it
  
  historicalMessages = queryHistory(schema.urlPattern)
  messagesProcessed = 0
  
  for each message in historicalMessages:
    if elapsed() > timeoutMs:
      storage.status = "Failed"
      storage.lastError = "Timeout after " + messagesProcessed + " messages"
      return failure()
    
    urlValues = extractUrlValues(message.url, schema.urlPattern, schema.primaryKey)
    if urlValues is null:
      logError("URL does not match pattern: " + message.url)
      continue
    
    mergedPayload = merge(urlValues, message.body)
    
    try:
      validatePayload(schema, mergedPayload)
    catch error:
      logError("Validation failed for message " + message.id + ": " + error)
      storage.lastError = error
      return failure()
    
    upsertRow(table, mergedPayload, schema.primaryKey)
    messagesProcessed += 1
    storage.currentPosition = message.position
  
  storage.status = "Online"
  return success()
```

## Collision Prevention

Once a schema is resolved to a final storage, that binding is immutable for the lifetime of the storage record. Schema replacement creates a new storage record, so:

- Old storage (with old schema) continues to exist after deactivation.
- New storage (with new schema) is a separate record.
- No collision: each storage has a unique binding to exactly one schema.

## Timeout Handling

All state transitions involving async operations (Activate, Reactivate) must have a configurable timeout:

- **Default**: 60 seconds
- **Configurable per**: deployment, realm, or command invocation
- **On Timeout**: Set status to Failed, store descriptive error, wait for operator to investigate and retry

## Validation Rules

1. **Schema Linked**: Storage must have a valid `schema_id` pointing to an existing schema.
2. **Table Exists**: Generated table must exist for the schema.
3. **State Consistency**: Storage status must match expected state for each command.
4. **No Orphaned Writes**: Once deactivated, no new writes to the table.

## Success Criteria

- Activate: backfill completes without errors and status reaches Online.
- Deactivate: status changes to deactivated, writes are rejected.
- Reactivate: backfill completes without errors and status reaches Online.
- Remove: table is dropped, storage record is deleted, record cannot be retrieved.
