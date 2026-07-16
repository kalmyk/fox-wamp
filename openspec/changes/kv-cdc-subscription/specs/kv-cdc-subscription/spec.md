## ADDED Requirements

### Requirement: Support for cdc in SUBSCRIBE
The system SHALL support an optional `cdc` boolean attribute in the options of a WAMP `SUBSCRIBE` message and Hyper API `subscribe` call for engines that support it.

#### Scenario: Subscribe message with cdc: true
- **WHEN** a client sends a `SUBSCRIBE` message with `options.cdc` set to `true` on an engine with `supportsCdcSubscription` true
- **THEN** the router SHALL accept the subscription and store the `cdc` flag with the subscription state

#### Scenario: Subscribe message with invalid cdc value
- **WHEN** a client sends a `SUBSCRIBE` message with `options.cdc` set to a non-boolean value
- **THEN** the router SHALL reject the subscription with a WAMP error

#### Scenario: cdc requested on unsupported engine
- **WHEN** a client sends a `SUBSCRIBE` message with `options.cdc` set to `true` on an engine with `supportsCdcSubscription` false
- **THEN** the router SHALL reject the subscription with an option-not-supported error

### Requirement: Change event envelope shape
When a subscription has `cdc: true`, the system SHALL deliver events using a change envelope of the form `{ before, after, op, source: { offset } }` instead of the plain data payload.

#### Scenario: Update envelope
- **WHEN** a KV write changes an existing value from `oldValue` to `newValue`
- **AND** a `cdc: true` subscriber matches the topic
- **THEN** the delivered event data SHALL be `{ before: oldValue, after: newValue, op: 'u', source: { offset: <eventId> } }`

#### Scenario: Create envelope
- **WHEN** a KV write sets a value at a topic with no prior stored value
- **AND** a `cdc: true` subscriber matches the topic
- **THEN** the delivered event data SHALL be `{ before: null, after: newValue, op: 'c', source: { offset: <eventId> } }`

#### Scenario: Delete envelope
- **WHEN** a KV write results in an empty value (deletion) for a topic with a prior stored value
- **AND** a `cdc: true` subscriber matches the topic
- **THEN** the delivered event data SHALL be `{ before: oldValue, after: null, op: 'd', source: { offset: <eventId> } }`

#### Scenario: Snapshot/replay envelope
- **WHEN** a `cdc: true` subscription with `retained: true` or `retainedState: true` performs its initial retained-state replay
- **THEN** each replayed record SHALL be delivered as `{ before: null, after: currentValue, op: 'r', source: { offset: <eventId> } }`

### Requirement: Op code values
The system SHALL derive the `op` field of a change envelope from the presence of `before`/`after` values, using single-letter Debezium-style codes.

#### Scenario: Op derivation for live changes
- **WHEN** constructing a live change envelope
- **THEN** the system SHALL set `op` to `'c'` if `before` is `null`, `'d'` if `after` is `null`, and `'u'` otherwise

#### Scenario: Op value for replay
- **WHEN** constructing a replay/snapshot envelope
- **THEN** the system SHALL set `op` to `'r'` regardless of the derivation rule used for live changes

### Requirement: Resumability via existing offset mechanism
The `source.offset` value in a change envelope SHALL be the same event ID accepted by the existing `after` SUBSCRIBE option, so a CDC subscription can resume without a separate position-tracking mechanism.

#### Scenario: Resuming a CDC stream
- **WHEN** a client previously received a change envelope with `source.offset: "EVENT_100"`
- **AND** the client re-subscribes with `cdc: true`, `retained: true`, and `after: "EVENT_100"`
- **THEN** the system SHALL apply the existing `after` retained-state-sync behavior using `EVENT_100` as the resume point

### Requirement: Local engine live delivery of change events
Engines that support `cdc` SHALL dispatch a live change event after every successful KV write that changes stored state, including writes resolved via `when`/`watch` conditions.

#### Scenario: Live dispatch after direct write
- **WHEN** a KV write is applied directly (no `when` condition)
- **THEN** the engine SHALL dispatch a live event carrying the resulting before/after state to matching subscribers

#### Scenario: Live dispatch after when/watch resolution
- **WHEN** a parked `watch` actor's `when` condition becomes satisfied by a subsequent write and is applied
- **THEN** the engine SHALL dispatch a live event carrying the resulting before/after state for that resolution, in the order the resolution was applied

#### Scenario: Ordering of offsets per topic
- **WHEN** multiple change events are dispatched for the same topic
- **THEN** their `source.offset` values SHALL be strictly increasing in dispatch order

### Requirement: Engine capability flag for cdc support
The system SHALL expose a `supportsCdcSubscription` capability flag on engines, used to accept or reject `cdc: true` subscriptions.

#### Scenario: Local engine support
- **WHEN** a `cdc: true` subscription is requested on the in-memory engine or the SQLite `DbEngine`
- **THEN** the router SHALL accept the subscription

#### Scenario: Distributed engine rejection
- **WHEN** a `cdc: true` subscription is requested on the distributed `NetEngine`
- **THEN** the router SHALL reject the subscription with an option-not-supported error
