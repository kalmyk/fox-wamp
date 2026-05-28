## Context

The system currently mixes two concerns:

- in-memory realm registration through `Realm.registerKeyValueEngine()`
- durable retained KV updates through SQLite storage code and save/update hooks

That path is outdated for distributed mode. Persistent KV state should be treated as a projection of committed history. Storage nodes already commit ordered history segments and emit `SEGMENT_COMMITTED`; the KV layer should listen to that committed-segment signal and update registered KV projections only after the history commit is durable.

## Goals / Non-Goals

**Goals:**
- Establish a persistent registry for KV projection modules.
- Enable tracking of storage lifecycle states: `inactive`, `refreshing`, `online`, `failed`.
- Persist the last reached committed event or segment watermark (`current_position`) as `TEXT`.
- Provide a dedicated activation command that refreshes a projection from committed history before it becomes online.
- Move persistent distributed KV updates from old realm save/update hooks to a listener on `SEGMENT_COMMITTED`.
- Define a committed-segment payload that contains the resolved segment and the committed event records needed by KV projections.

**Non-Goals:**
- Real-time performance metrics for storages.
- Automated failover or load balancing between storages.
- Full audit log of all status changes (only the current status is persisted).
- Replacing local in-memory KV registration for non-distributed tests and local engines.
- Automatic background activation of newly registered projections without an explicit activation command.

## Decisions

### 1. Centralized Registry Storage
We will use the primary SQLite database used by storage/history metadata to host the `kv_storages` table.
- **Rationale**: The registry describes durable KV projections over committed history. Keeping it beside history metadata makes projection startup, status checks, and position tracking local to the storage node.
- **Alternatives**: File-based storage (harder to query), or in-memory (loses state on restart).

### 2. Table Schema
The `kv_storages` table will be defined as follows:
```sql
CREATE TABLE kv_storages (
    name TEXT PRIMARY KEY,
    realm_name TEXT NOT NULL,
    uri_pattern TEXT NOT NULL,
    storage_type TEXT NOT NULL,
    started_at INTEGER, -- Unix timestamp in milliseconds
    status TEXT NOT NULL CHECK(status IN ('inactive', 'refreshing', 'online', 'failed')) DEFAULT 'inactive',
    current_position TEXT,
    last_error TEXT
);
```

`current_position` is `TEXT` because event IDs in this codebase are strings. Distributed event positions are also segment-derived IDs rather than simple integers.

`uri_pattern` is also `TEXT`, but it is not MQTT slash syntax and not a JSON array. It stores the canonical dotted FOX topic form, for example `app.topic.#`. Projection code should parse it with `defaultParse()` into the internal `string[]` representation before matching events. MQTT slash topics are normalized at the MQTT gate before they reach this registry.

### 3. Persistent KV Projection Boundary
Persistent KV updates SHALL be applied by a listener on `SEGMENT_COMMITTED`.

The old path:

```text
Realm.registerKeyValueEngine()
  -> BaseEngine.updateKvFromActor()
  -> SqliteKv/MemKv.setKeyActor()
  -> saveChangeHistory/onSave side effects
```

is not the persistent distributed registration model.

The new distributed projection path:

```text
KEEP_ADVANCE_HISTORY
  -> StorageTask buffers segment
  -> ADVANCE_SEGMENT_RESOLVED
  -> StorageTask.commit_segment()
  -> SEGMENT_COMMITTED
  -> KV projection listener applies retained mutations
  -> kv_storages.current_position is advanced
```

### 4. Committed Segment Payload
`SEGMENT_COMMITTED` SHALL emit a payload containing the resolved segment and the committed event records:

```ts
type CommittedSegmentEvent = {
  advanceOwner: string
  advanceSegment: number
  segment: string
  events: Array<{
    eventId: string
    realm: string
    uri: string[]
    data: any
    opt: any
    sid: string
    shard: number
  }>
}
```

The `uri` field in the payload is the internal separator-free topic array. If a listener stores it in SQLite metadata or FOX API output, it serializes it with `restoreUri()` to dotted text. The KV projection listener can apply retained KV mutations directly from this payload without re-reading history. If a committed event does not request retained KV behavior, the listener ignores it for KV projection purposes.

### 5. Retained KV Mutation Selection
A committed event is eligible for persistent KV projection when `event.opt.retain === true`. The retain flag marks that the event should be kept as retained state; it does not by itself choose a storage.

Storage selection is based on registered KV projections. Each projection has an accepted URL pattern in `kv_storages.uri_pattern`. A retained event may be stored in zero, one, or many projections:

```text
event.opt.retain === true
AND event.realm == projection.realm_name
AND match(event.uri, defaultParse(projection.uri_pattern))
```

When the event matches a projection, the projected value is the event body value after normal FOX body decoding (`getBodyValue`). If a schema is registered for the accepted URL, the value MUST be validated by that schema before it is stored. The exact schema-extension shape for provisioning tables belongs to the `message-schema-repository` change; this registry only requires that matching retained values are validated before projection storage when a schema applies.

Deletes use the existing retained-storage empty-value rule. After body decoding, if `isDataEmpty(event.data)` is true, the projection deletes the retained row instead of storing a value. This includes MQTT retained publishes with an empty payload, because the MQTT gate maps an empty payload to `null`, and `null` is accepted as an empty value for delete.

### 6. Event ID and Activation Target
Committed event IDs are text values built from the resolved segment ID plus the event offset inside that segment:

```text
eventId = <string-segment-id><string-event-offset>
```

`<string-event-offset>` is produced by `keyId(id: number)` from `lib/masterfree/makeid.ts`. It is a sortable string alternative to the numeric event offset, so event IDs remain lexicographically ordered as offsets grow.

Event IDs SHALL be compared as strings. The ID generation functions are designed to produce event ID strings whose lexicographic order matches event order, so activation and catch-up logic should use normal string comparisons such as `msg_id > current_position` and `msg_id <= activation_target`. Implementations should not parse event IDs into segment and offset parts for ordering.

A single dbnode may commit events for several realms in one resolved segment. KV projection activation is realm-scoped, so the activation target is the latest committed `eventId` for the projection's `realm_name`, not merely the latest global segment and not the latest event from another realm.

At activation start, the projection captures the latest committed event ID for its realm as the activation target. Refresh applies related events for the same realm in committed event order until `current_position` reaches that realm-scoped target. If the realm has no committed events, activation may complete immediately and move the projection online.

If the realm has no committed events at activation time, `current_position` remains `NULL`. This is only the initial empty-realm state. After a projection is active, every `SEGMENT_COMMITTED` advances the position watermark for all active KV projections, even if the segment contains no matching KV mutation for a projection. Each committed segment has a segment ID, and each next segment ID compares greater than the previous message ID or segment ID when compared as a string. This lets active projections move their `current_position` forward on segment commits without parsing IDs.

### 7. Activation and Status Lifecycle
- **Registration**: Occurs when a persistent KV projection is configured or initialized. Registration creates the row with `status = 'inactive'`. It does not start historical replay or live segment application.
- **Activation**: A dedicated command activates a registered projection. Activation sets `status = 'refreshing'`, clears `last_error`, records `started_at`, captures the realm-scoped activation target, reads committed history events related to the projection's `realm_name` and `uri_pattern`, applies matching KV mutations, and advances `current_position`.
- **Activation by Current Status**: Activation is allowed when status is `inactive` or `failed`. Activation while `refreshing` is rejected as already running. Activation while `online` is a no-op success and does not replay history.
- **Refresh/Catch-up**: While the activation command is applying historical events, the projection remains `refreshing`. The projection should apply events in committed event order until it reaches the realm-scoped activation target observed at activation time.
- **Online**: When catch-up reaches the realm-scoped activation target, the projection sets `status = 'online'` and begins applying later `SEGMENT_COMMITTED` payloads as live committed updates.
- **Failed**: If activation or refresh fails, the projection sets `status = 'failed'`, writes the error message to `last_error`, and does not claim to be online. A later activation command may retry from the stored `current_position`.
- **Reset**: A reset command clears the projected KV data for the storage, sets `current_position = NULL`, clears `last_error`, and sets `status = 'inactive'`. A reset does not automatically activate the projection; a later activation command rebuilds it from committed history.
- **Current Position**: A string watermark for the latest committed event or segment the active projection has reached. During activation it advances through inspected realm events. After the projection is online, every `SEGMENT_COMMITTED` advances active KV projections to at least the committed segment ID, and matching KV mutations advance through their committed event IDs.

## Risks / Trade-offs

- **[Risk] Write Amplification** → Frequent updates to `current_position` in SQLite might increase I/O.
    - **Mitigation**: Use transactions effectively. Since KV updates are already transactional, the position update can be bundled with the data update.
- **[Risk] Event signal too small** → Emitting only `BODY_ADVANCE_SEGMENT_RESOLVED` is not enough for KV projection because the listener would need to re-read history and reconstruct the event IDs.
    - **Mitigation**: Emit the full committed event records in `SEGMENT_COMMITTED`.
- **[Risk] Race Conditions in Distributed Mode** → Multiple projections might try to update the same storage record.
    - **Mitigation**: Use idempotent registration and ensure storage names are unique per projection responsibility.
- **[Risk] Activation race with live commits** → New segments may commit while a projection is refreshing historical events.
    - **Mitigation**: The activation command captures the realm-scoped latest committed event ID as its catch-up target. The projection becomes online only after it has applied through that target, then consumes later `SEGMENT_COMMITTED` payloads.
- **[Risk] Reset leaves stale projected data** → Resetting only metadata would replay history on top of old projection state and could produce incorrect KV values.
    - **Mitigation**: Reset must clear the projected KV data and the registry position together before returning the projection to `inactive`.
- **[Risk] Idle projections appear stale** → If position only advanced on matching KV mutations, an online projection with no matching writes could look behind the cluster.
    - **Mitigation**: Active projections advance their `current_position` watermark on every committed segment because segment IDs are string-ordered after previous message IDs and segments.
