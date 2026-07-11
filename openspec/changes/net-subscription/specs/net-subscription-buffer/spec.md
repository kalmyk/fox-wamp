# net-subscription-buffer Specification

## Purpose

Defines `SharedSegmentBuffer`: a per-realm, per-entry-node in-memory buffer that holds events fetched from storage nodes. Multiple `ActorNetSub` instances share one buffer per realm, so storage is fetched at most once per realm per storage node.

## Requirements

### Requirement: One buffer per realm on entry

`NetEngineMill` SHALL maintain at most one `SharedSegmentBuffer` per realm name. All `ActorNetSub` instances for the same realm SHALL use the same buffer instance.

#### Scenario: Second subscriber reuses existing buffer

- **WHEN** a `SharedSegmentBuffer` for realm `myapp` already exists and is loading
- **AND** a second `ActorNetSub` for realm `myapp` requests history
- **THEN** no new RPC call to storage SHALL be made
- **AND** both actors SHALL receive events from the same buffer

### Requirement: Buffer triggers fetch from all storage nodes

When a `SharedSegmentBuffer` is first accessed for a realm and no fetch is in progress, it SHALL call `fox.storage.history.fetch` on every connected storage node for that realm concurrently.

#### Scenario: Fetch triggered on first access

- **WHEN** `SharedSegmentBuffer.ensureLoading(storageClients)` is called for the first time
- **THEN** `fox.storage.history.fetch` SHALL be called on each client in `storageClients`
- **AND** `loading` SHALL be set to `true`

### Requirement: Events appended in event_id ASC order

Events received from all storage node progress calls SHALL be merged into a single append-only list sorted by `event_id ASC`. Out-of-order events from different storage nodes SHALL be interleaved correctly.

#### Scenario: Two-node merge in event_id order

- **WHEN** nodeA emits progress with events `[EVT_10, EVT_20]` and nodeB emits `[EVT_15, EVT_25]`
- **THEN** the buffer's event list SHALL be `[EVT_10, EVT_15, EVT_20, EVT_25]`

#### Scenario: Out-of-order delivery detected

- **WHEN** an event with `event_id < buffer.lastEventId` is received (from any node)
- **THEN** the buffer SHALL log an error indicating out-of-order delivery
- **AND** SHALL still append the event at its correct sorted position

### Requirement: Waiters notified on new events

Any caller waiting for events past a given cursor SHALL be notified when new events are appended.

#### Scenario: Waiter unblocked when event arrives

- **WHEN** an `ActorNetSub` is waiting for events after `EVT_X`
- **AND** the buffer receives an event `EVT_Y` where `EVT_Y > EVT_X`
- **THEN** the waiter callback SHALL be invoked

### Requirement: Done flag set when all fetches complete

When all concurrent `fox.storage.history.fetch` calls return `{ done: true }`, the buffer SHALL set `done = true` and notify all remaining waiters.

#### Scenario: Waiters unblocked on completion

- **WHEN** all storage node fetches complete
- **AND** an `ActorNetSub` is still waiting for events that do not exist
- **THEN** the waiter SHALL be notified with `done = true` so it can release the actor
