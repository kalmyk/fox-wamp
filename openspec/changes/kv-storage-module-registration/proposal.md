## Why

The system currently has an outdated key-value storage registration path tied to in-memory realm registration and direct update hooks. Persistent KV state should instead be maintained as a projection of committed history. A registry table is needed to define those persistent KV projections, track their lifecycle, and record the last committed event position applied by each projection.

## What Changes

- **New Registration Table**: Create a `kv_storages` table to register persistent KV projection modules.
- **Storage Fields**:
    - `name`: Unique identifier for the storage instance.
    - `realm_name`: Realm whose committed events feed this projection.
    - `uri_pattern`: Canonical dotted FOX topic pattern this storage is responsible for, such as `app.topic.#`.
    - `storage_type`: Implementation type, such as `sqlite`.
    - `started_at`: Timestamp when the storage was last started.
    - `status`: Lifecycle state (`inactive`, `refreshing`, `online`, `failed`).
    - `current_position`: The last committed event or segment watermark reached by the KV projection, stored as `TEXT`.
    - `last_error`: Text description of the last activation or refresh failure.
- **Activation Command**: Add a dedicated command to activate a registered projection. Activation reads historical events matching the projection, applies them, and catches up to the realm-scoped activation target.
- **Committed Segment Signal**: Extend the storage commit path so `SEGMENT_COMMITTED` emits a payload containing the resolved segment and the committed event records.
- **KV Projection Listener**: Move persistent KV updates from old save/update hooks to a listener that applies retained KV mutations after `SEGMENT_COMMITTED`.
- **Status Management**: Logic to update projection status during initialization, refresh, and normal operation.

## Capabilities

### New Capabilities
- `kv-storage-registry`: Standardized registration, lifecycle tracking, and committed-position tracking for persistent KV projection modules.

### Modified Capabilities
- `distributed-mode`: Persistent KV updates are driven by committed segment visibility instead of pre-commit realm update hooks.

## Impact

- Storage commit flow in `lib/masterfree/storage.ts`.
- Persistent KV projection logic in `lib/sqlite/sqlitekv.ts` or a new projection module.
- Metadata management for KV projections.
- Potential updates to `lib/types.ts` for storage status enums.
- Existing in-memory `Realm.registerKeyValueEngine()` usage remains for local/in-memory compatibility but is not the persistent distributed KV registration mechanism.
