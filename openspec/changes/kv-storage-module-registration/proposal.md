## Why

The system currently lacks a centralized registry for key-value storage backends. This makes it difficult to manage multiple storage instances, track their synchronization status, and ensure that message processing is consistent across restarts. A registration table is needed to provide visibility into the storage topology and operational state.

## What Changes

- **New Registration Table**: Create a `kv_storages` (or similar) table to register all available storage modules.
- **Storage Fields**:
    - `name`: Unique identifier for the storage instance.
    - `uri_pattern`: The URI pattern this storage is responsible for.
    - `started_at`: Timestamp when the storage was last started.
    - `status`: Lifecycle state (`inactive`, `refreshing`, `online`).
    - `current_position`: The last processed message ID (event sequence number) to support recovery and sync.
- **Status Management**: Logic to update storage status during initialization, synchronization, and normal operation.

## Capabilities

### New Capabilities
- `kv-storage-registry`: Standardized registration and lifecycle tracking for KV storage modules.

### Modified Capabilities
- None.

## Impact

- Storage initialization logic in `lib/realm.ts` or `lib/sqlite/dbengine.ts`.
- Metadata management for KV backends.
- Potential updates to `lib/types.ts` for storage status enums.
