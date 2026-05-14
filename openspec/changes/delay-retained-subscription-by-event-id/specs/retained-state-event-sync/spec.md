## ADDED Requirements

### Requirement: Support for after in SUBSCRIBE
The system SHALL support an optional `after` attribute in the options of a WAMP `SUBSCRIBE` message for the in-memory engine and the SQLite `DbEngine`.

#### Scenario: Subscribe message with after
- **WHEN** a WAMP client sends a `SUBSCRIBE` message with `options.after` set to a valid event ID string
- **THEN** the router SHALL accept the subscription and store the `after` with the subscription state

#### Scenario: Subscribe message with invalid after
- **WHEN** a WAMP client sends a `SUBSCRIBE` message with `options.after` set to an invalid event ID value
- **THEN** the router SHALL reject the subscription with a WAMP error

#### Scenario: after without retained replay
- **WHEN** a WAMP client sends a `SUBSCRIBE` message with `options.after` but without `retained` or `retainedState`
- **THEN** the router SHALL accept the subscription
- **AND** the router SHALL NOT delay live event delivery for that subscription

### Requirement: Delayed retained state fetching
If a subscription requests `retained` or `retainedState` and provides an `after`, the system SHALL delay fetching retained state from storage until retained storage has committed an event ID greater than or equal to the specified ID.

#### Scenario: Delayed fetch until event ID is reached
- **WHEN** a subscription with `retained: true` and `after: "EVENT_123"` is created
- **AND** retained storage has not committed `EVENT_123`
- **THEN** the system SHALL NOT send any retained events immediately
- **WHEN** retained storage subsequently commits `EVENT_123`
- **THEN** the system SHALL fetch the retained state and send it to the subscriber

#### Scenario: Immediate fetch if event ID is already reached
- **WHEN** a subscription with `retained: true` and `after: "EVENT_001"` is created
- **AND** retained storage has already committed `EVENT_001` or a later comparable event ID
- **THEN** the system SHALL immediately fetch and send the retained state

#### Scenario: Subscription remains live while retained replay waits
- **WHEN** a subscription with `retained: true` and `after: "EVENT_123"` is created
- **AND** retained storage has not yet committed `EVENT_123`
- **THEN** the router SHALL register the subscription and send the normal subscription acknowledgement
- **AND** matching live events MAY be delivered before delayed retained events

#### Scenario: Wait is cancelled when subscription ends
- **WHEN** a subscription with delayed retained replay is waiting for `after`
- **AND** the client unsubscribes or the session is cleaned up
- **THEN** the router SHALL remove the pending retained replay waiter
- **AND** the router SHALL NOT send retained events for the removed subscription

#### Scenario: Wait timeout
- **WHEN** a subscription with delayed retained replay waits for a valid but unreachable `after`
- **AND** the configured wait timeout elapses
- **THEN** the router SHALL remove the pending retained replay waiter
- **AND** the subscription SHALL remain active for live events
- **AND** retained replay SHALL be skipped for that subscription

### Requirement: Event ID tracking in Engines
Engines that support `after` SHALL provide a mechanism to track the last committed retained-storage event ID and allow components to wait for a specific retained event ID to be reached.

#### Scenario: Waiting for event ID
- **WHEN** a component requests to wait for `EVENT_456`
- **AND** retained storage commits an event with ID `EVENT_456` or a later comparable ID
- **THEN** the engine SHALL notify the waiting component

#### Scenario: Non-retained publish does not satisfy retained wait
- **WHEN** a component waits for retained event ID `EVENT_456`
- **AND** the engine processes a non-retained publish with ID `EVENT_456`
- **THEN** the engine SHALL NOT satisfy the retained-state wait from that non-retained publish

#### Scenario: Stored event has event ID before retained storage write
- **WHEN** a retained publish is processed by an engine that supports `after`
- **THEN** the engine SHALL assign a comparable event ID before writing the event to retained storage
- **AND** retained lookup SHALL return that event ID with the retained row

#### Scenario: Non-stored event may omit event ID
- **WHEN** an event is not written to retained key-value storage or event history storage
- **THEN** the engine MAY process the event without assigning an event ID

### Requirement: Shared local engine behavior
The in-memory engine and SQLite `DbEngine` SHALL pass the same retained-state event synchronization behavior tests.

#### Scenario: Same test cases run against both local engines
- **WHEN** the retained synchronization test suite runs
- **THEN** each required retained synchronization scenario SHALL run against the in-memory engine
- **AND** each required retained synchronization scenario SHALL run against SQLite `DbEngine`
