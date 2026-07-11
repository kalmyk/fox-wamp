# net-history-fetch Specification

## Purpose

Defines the `fox.storage.history.fetch` progressive RPC that the storage node exposes on the sys realm. Callers stream committed events from `event_history_<realm>` in `event_id ASC` order using cursor-based pagination.

## Requirements

### Requirement: RPC registered on storage connect

`EventStorageTask` SHALL register `fox.storage.history.fetch` on its sys-realm API when constructed. The registration SHALL remain active for the lifetime of the task.

#### Scenario: RPC available after construction

- **WHEN** `EventStorageTask` is constructed with a `DbFactory` and shard config
- **THEN** `fox.storage.history.fetch` is registered on the sys realm and callable by any API client on that realm

### Requirement: Progressive event streaming by realm

The handler SHALL accept `{ realm: string, afterEventId: string | null }` and stream events from `event_history_<realm>` via `opt.progress` calls in `msg_id ASC` order.

#### Scenario: Full realm history from beginning

- **WHEN** a caller invokes `fox.storage.history.fetch` with `{ realm: 'myapp', afterEventId: null }`
- **THEN** the handler SHALL emit one or more `opt.progress` calls, each with `{ events: HistoryEvent[], lastEventId: string }`
- **AND** all events in `event_history_myapp` SHALL appear exactly once across all progress calls
- **AND** events SHALL be ordered by `event_id ASC` within and across progress calls
- **AND** the final result SHALL be `{ done: true }`

#### Scenario: Cursor-based fetch from afterEventId

- **WHEN** a caller invokes with `{ realm: 'myapp', afterEventId: 'EVT_ABC' }`
- **THEN** the handler SHALL emit only events with `msg_id > 'EVT_ABC'`
- **AND** events SHALL be ordered by `msg_id ASC`

#### Scenario: No events after cursor

- **WHEN** a caller invokes with `{ realm: 'myapp', afterEventId: '<latest event id>' }`
- **THEN** the handler SHALL emit no progress calls
- **AND** SHALL return `{ done: true }` immediately

#### Scenario: Realm has no history table

- **WHEN** a caller invokes with `{ realm: 'unknown' }` and no `event_history_unknown` table exists
- **THEN** the handler SHALL return `{ done: true }` without error

### Requirement: Progress batch contains at least one segment's events

Each `opt.progress` call SHALL correspond to one committed segment's events (events sharing the same segment ID prefix). An empty segment SHALL be omitted.

#### Scenario: Events grouped by segment

- **WHEN** events `EVT_S1_1`, `EVT_S1_2` belong to segment `S1` and `EVT_S2_1` belongs to segment `S2`
- **THEN** the handler SHALL emit two progress calls: one with `[EVT_S1_1, EVT_S1_2]`, one with `[EVT_S2_1]`

### Requirement: HistoryEvent shape in progress payload

Each event in the progress `events` array SHALL have:
- `eventId: string` — the `msg_id` value
- `shardTag: number` — the `msg_shard` value  
- `uri: string[]` — parsed topic segments
- `data: any` — deserialized body
- `opt: any` — message options

#### Scenario: Event fields present

- **WHEN** storage emits a progress call
- **THEN** every event object in `events` SHALL include `eventId`, `shardTag`, `uri`, `data`, and `opt`
