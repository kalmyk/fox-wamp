## Context

The system utilizes multiple key-value storage backends (e.g., SQLite-based, memory-based). Currently, there is no centralized mechanism to track which storages are active, their operational status, or their synchronization progress relative to the global message stream. This lack of visibility complicates monitoring and recovery after crashes or restarts.

## Goals / Non-Goals

**Goals:**
- Establish a persistent registry for KV storage modules.
- Enable tracking of storage lifecycle states: `inactive`, `refreshing`, `online`.
- Persist the last processed message ID (`current_position`) to allow storages to resume from where they left off.

**Non-Goals:**
- Real-time performance metrics for storages.
- Automated failover or load balancing between storages.
- Full audit log of all status changes (only the current status is persisted).

## Decisions

### 1. Centralized Registry Storage
We will use the primary SQLite database (typically used for history and realm metadata) to host the `kv_storages` table.
- **Rationale**: The registry needs to be persistent and easily accessible by the router core. SQLite is already a dependency and used for similar metadata.
- **Alternatives**: File-based storage (harder to query), or in-memory (loses state on restart).

### 2. Table Schema
The `kv_storages` table will be defined as follows:
```sql
CREATE TABLE kv_storages (
    name TEXT PRIMARY KEY,
    uri_pattern TEXT NOT NULL,
    started_at INTEGER, -- Unix timestamp in milliseconds
    status TEXT CHECK(status IN ('inactive', 'refreshing', 'online')) DEFAULT 'inactive',
    current_position INTEGER DEFAULT 0
);
```

### 3. Status Lifecycle Management
- **Registration**: Occurs during the first initialization of a storage module.
- **Refresh**: Set when a storage begins loading historical data or syncing with a master.
- **Online**: Set when the storage is fully synced and ready to handle live traffic.
- **Current Position**: Updated every time a message is successfully committed to the storage.

## Risks / Trade-offs

- **[Risk] Write Amplification** → Frequent updates to `current_position` in SQLite might increase I/O.
    - **Mitigation**: Use transactions effectively. Since KV updates are already transactional, the position update can be bundled with the data update.
- **[Risk] Race Conditions in Distributed Mode** → Multiple nodes might try to update the same storage record.
    - **Mitigation**: Use `INSERT OR IGNORE` for registration and ensure that storage names are unique per instance/responsibility.
