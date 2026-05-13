## ADDED Requirements

### Requirement: Support for after_event_id in SUBSCRIBE
The system SHALL support an optional `after_event_id` attribute in the options of a WAMP `SUBSCRIBE` message.

#### Scenario: Subscribe message with after_event_id
- **WHEN** a WAMP client sends a `SUBSCRIBE` message with `options.after_event_id` set to a valid event ID string
- **THEN** the router SHALL accept the subscription and store the `after_event_id` with the subscription state

### Requirement: Delayed retained state fetching
If a subscription requests `retained` state and provides an `after_event_id`, the system SHALL delay fetching the retained state from storage until the storage has processed the event with the specified ID.

#### Scenario: Delayed fetch until event ID is reached
- **WHEN** a subscription with `retained: true` and `after_event_id: "EVENT_123"` is created
- **AND** the storage has not yet processed `EVENT_123`
- **THEN** the system SHALL NOT send any retained events immediately
- **WHEN** the storage subsequently processes `EVENT_123`
- **THEN** the system SHALL fetch the retained state and send it to the subscriber

#### Scenario: Immediate fetch if event ID is already reached
- **WHEN** a subscription with `retained: true` and `after_event_id: "EVENT_001"` is created
- **AND** the storage has already processed `EVENT_001`
- **THEN** the system SHALL immediately fetch and send the retained state

### Requirement: Event ID tracking in Engines
Engines SHALL provide a mechanism to track the last processed event ID and allow components to wait for a specific event ID to be reached.

#### Scenario: Waiting for event ID
- **WHEN** a component requests to wait for `EVENT_456`
- **AND** the engine processes an event with ID `EVENT_456` (or greater, if IDs are monotonic)
- **THEN** the engine SHALL notify the waiting component
