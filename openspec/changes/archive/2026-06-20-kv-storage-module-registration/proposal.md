## Why

The system currently has an outdated key-value storage registration path tied to in-memory realm registration and direct update hooks. Persistent KV state should instead be maintained as a projection of committed history. A registry table is needed to define those persistent KV projections, track their lifecycle, and record the last committed event position applied by each projection.

## What Changes

- **New Registration Table**: Create realm-scoped `storage_desc_${realmName}` tables to register persistent KV projection modules, matching the existing `kv_${realmName}` table naming style.
- **Storage Fields**:
    - `name`: Unique identifier for the storage instance.
    - Realm is selected by table name, not by a row column.
    - `uri_pattern`: Canonical dotted FOX topic prefix/pattern this storage is responsible for, such as `app.topic.#`.
    - `schema_id`: Required link to exactly one message schema that owns validation and the generated projection table.
    - `started_at`: Timestamp when the storage was last started.
    - `status`: Lifecycle state (`inactive`, `refreshing`, `online`, `failed`).
    - `current_position`: The last committed event or segment watermark reached by the KV projection, stored as `TEXT`.
    - `last_error`: Text description of the last activation or refresh failure.
- **Activation Command**: Add a dedicated command to activate a registered projection. Activation reads historical events matching the projection, applies them, and catches up to the realm-scoped activation target.
- **Committed Segment Signal**: Extend the storage commit path so `SEGMENT_COMMITTED` emits a payload containing the resolved segment and the committed event records.
- **KV Projection Listener**: Move persistent KV updates from old save/update hooks to a listener that applies retained KV mutations after `SEGMENT_COMMITTED`. Protocol gates normalize MQTT slash topics and WAMP dotted topics into canonical dotted FOX topics before matching, so both protocols use the same projection-selection rules. Each matching schema/projection applies independently to its own generated projection table set.
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

## Open Questions

### Activation, Reset, and Deactivate Command Surface

The design names implementation-shaped operations such as `activateProjection()` and `resetProjection()`, but the externally visible administrative contract still needs to be defined.

- What are the Hyper/FOX topics or command names for activation, reset, deactivate, status, and list operations?
- What request payload does each command accept?
- What success and error result shape does each command return?
- Are these commands internal-only, or are they exposed through `foxctl`?

### Projection Position After Matching Mutations

The design states that matching KV mutations advance with event IDs and idle segments advance with the segment ID. The exact algorithm still needs to be written down.

- Within a committed segment containing multiple matching retained mutations, does `current_position` advance after each applied event or only once at the end?
- If a segment has retained events for other realms or non-matching URI patterns, should the projection advance to the committed segment ID after inspecting the segment?
- If a segment has both matching and non-matching retained events, is the final position the last matching event ID or the committed segment ID?
- What happens to `current_position` when the projection is `inactive`, `refreshing`, or `failed` while new segments commit?

### `Realm.registerKeyValueEngine()` Compatibility Boundary

Task 4.11 remains open and should explicitly describe the compatibility boundary between the old local path and the new distributed projection path.

- In-memory/local KV remains supported for compatibility and tests.
- Persistent distributed projection uses the schema repository plus `storage_desc_${realmName}` only.
- The old local path and the persistent distributed path must not both write the same retained projection in distributed mode.
