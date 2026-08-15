# net-history-fetch Specification

## Purpose

Defines the `fox.storage.history.fetch.<shardTag>` progressive RPC that a storage node exposes on the sys realm for each shard it owns. Callers stream committed events from `event_history_<realm>`, filtered to that shard, in `event_id ASC` order using cursor-based pagination. Registering per shard (rather than one procedure per realm) lets multiple storage nodes replicating the same shard register the identical procedure URI — the existing shared-registration RPC dispatch (`doCall` in `lib/realm.ts`) picks whichever registrant is available, so shard replication needs no dedicated selection logic on the caller side.

## Requirements

### Requirement: RPC registered per shard owned

`EventStorageTask` SHALL register `fox.storage.history.fetch.<shardTag>` on its sys-realm API for each shard tag in its shard configuration, when constructed. The registration SHALL remain active for the lifetime of the task.

#### Scenario: RPC available per owned shard after construction

- **WHEN** `EventStorageTask` is constructed with a `DbFactory` and `{ shards: [0, 1] }`
- **THEN** both `fox.storage.history.fetch.0` and `fox.storage.history.fetch.1` are registered on the sys realm and callable by any API client on that realm
- **AND** no procedure is registered for shards not in its configuration

#### Scenario: Replicated shard has multiple registrants

- **WHEN** two separately-constructed `EventStorageTask` instances are both configured with shard `0` in their shard list
- **THEN** both register `fox.storage.history.fetch.0`
- **AND** a call to `fox.storage.history.fetch.0` SHALL be served by whichever registrant the router's existing RPC dispatch selects (no error, no ambiguity — this is the same "first available registrant" behavior any shared registration already has)

### Requirement: Progressive event streaming by realm, filtered to the registered shard

The handler for `fox.storage.history.fetch.<shardTag>` SHALL accept `{ realm: string, afterEventId: string | null }` and stream events from `event_history_<realm>` that belong to `shardTag`, via `opt.progress` calls in `msg_id ASC` order.

#### Scenario: Full shard history from beginning

- **WHEN** a caller invokes `fox.storage.history.fetch.0` with `{ realm: 'myapp', afterEventId: null }`
- **THEN** the handler SHALL emit one or more `opt.progress` calls, each with `{ events: HistoryEvent[], lastEventId: string }`
- **AND** every event in `event_history_myapp` with `msg_shard = 0` SHALL appear exactly once across all progress calls
- **AND** no event with a different `msg_shard` SHALL appear
- **AND** events SHALL be ordered by `event_id ASC` within and across progress calls
- **AND** the final result SHALL be `{ done: true }`

#### Scenario: Cursor-based fetch from afterEventId

- **WHEN** a caller invokes with `{ realm: 'myapp', afterEventId: 'EVT_ABC' }`
- **THEN** the handler SHALL emit only events with `msg_id > 'EVT_ABC'` and `msg_shard` matching the registered procedure's shard tag
- **AND** events SHALL be ordered by `msg_id ASC`

#### Scenario: No events after cursor

- **WHEN** a caller invokes with `{ realm: 'myapp', afterEventId: '<latest event id for this shard>' }`
- **THEN** the handler SHALL emit no progress calls
- **AND** SHALL return `{ done: true }` immediately

#### Scenario: Realm has no history table

- **WHEN** a caller invokes with `{ realm: 'unknown' }` and no `event_history_unknown` table exists
- **THEN** the handler SHALL return `{ done: true }` without error

### Requirement: No registrant for a shard is a graceful no-data outcome, not an error surfaced to the subscriber

When no storage node currently owns/registers a given shard tag, calling `fox.storage.history.fetch.<shardTag>` SHALL fail with the standard "no callee registered" error (existing `doCall` behavior for an unregistered procedure). The entry-side caller SHALL treat this as "no data available for this shard right now" and proceed with the other shards' results, not as a fatal error for the whole realm fetch.

#### Scenario: Shard currently has no coverage

- **WHEN** `fox.storage.history.fetch.5` is called and no storage node has registered it
- **THEN** the call SHALL fail with `ERROR_NO_SUCH_PROCEDURE`
- **AND** the caller (see `net-subscription-buffer`) SHALL treat this identically to a shard that returned `{ done: true }` with zero events, not abort the realm fetch

### Requirement: Progress batch contains at least one segment's events

Each `opt.progress` call SHALL correspond to one committed segment's events for that shard (events sharing the same segment ID prefix). An empty segment SHALL be omitted.

#### Scenario: Events grouped by segment

- **WHEN** events `EVT_S1_1`, `EVT_S1_2` belong to segment `S1` and `EVT_S2_1` belongs to segment `S2`, all on the registered shard
- **THEN** the handler SHALL emit two progress calls: one with `[EVT_S1_1, EVT_S1_2]`, one with `[EVT_S2_1]`

### Requirement: HistoryEvent shape in progress payload

Each event in the progress `events` array SHALL have:
- `eventId: string` — the `msg_id` value
- `shardTag: number` — the `msg_shard` value (equal to the shard tag encoded in the procedure URI that was called)
- `uri: string[]` — parsed topic segments
- `data: any` — deserialized body
- `opt: any` — message options

#### Scenario: Event fields present

- **WHEN** storage emits a progress call
- **THEN** every event object in `events` SHALL include `eventId`, `shardTag`, `uri`, `data`, and `opt`
