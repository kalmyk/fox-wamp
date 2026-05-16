## ADDED Requirements

### Requirement: Support for snapshot in SUBSCRIBE
The system SHALL support an optional `snapshot` boolean attribute in the options of a WAMP `SUBSCRIBE` message and Hyper API `subscribe` call.

#### Scenario: Subscribe message with snapshot: true
- **WHEN** a client sends a `SUBSCRIBE` message with `options.snapshot` set to `true`
- **THEN** the router SHALL accept the subscription and store the `snapshot` flag with the subscription state

### Requirement: Automatic unsubscription after snapshot delivery
If a subscription has the `snapshot` flag set to `true`, the system SHALL automatically unsubscribe the client after all initial data replay (retained state and/or history) has been dispatched.

#### Scenario: Snapshot with retained data
- **WHEN** a subscription with `snapshot: true` and `retained: true` is created
- **AND** there is matching retained data in storage
- **THEN** the router SHALL send the retained data to the client
- **AND** the router SHALL automatically unsubscribe the client after the last retained event is sent

#### Scenario: Snapshot with history data
- **WHEN** a subscription with `snapshot: true` and `after` is created
- **AND** there is matching history data in storage
- **THEN** the router SHALL send the history records to the client
- **AND** the router SHALL automatically unsubscribe the client after the last history record is sent

### Requirement: Hyper API promise resolution for snapshot
For Hyper API `subscribe` calls with `snapshot: true`, the promise SHALL resolve after the initial snapshot data fetch has been initiated and acknowledged.

#### Scenario: Hyper API subscribe snapshot resolution
- **WHEN** `HyperClient.subscribe` is called with `snapshot: true`
- **AND** the subscription setup is acknowledged and initial data fetching is triggered
- **THEN** the promise returned by `subscribe` SHALL resolve with the success status of the operation
- **AND** the router SHALL automatically unsubscribe the client once all data is sent

#### Scenario: Snapshot with no data
- **WHEN** a subscription with `snapshot: true` is created for a topic with no retained data and no history requested
- **THEN** the router SHALL immediately unsubscribe the client
- **AND** the Hyper API `subscribe` promise SHALL resolve promptly after unsubscription

### Requirement: Prevention of live event delivery for snapshots
A subscription with `snapshot: true` SHALL NOT deliver any live events that arrive after the subscription is created but before the snapshot replay is complete.

#### Scenario: Live event during snapshot replay
- **WHEN** a subscription with `snapshot: true` is performing its initial data replay
- **AND** a new event is published to the same topic
- **THEN** the new event SHALL NOT be delivered to the snapshot subscriber
- **AND** the snapshot subscriber SHALL be unsubscribed normally after the initial replay finishes

### Requirement: MQTT support for snapshot
The MQTT gateway SHALL support the `snapshot` option in its internal subscription logic.

#### Scenario: MQTT subscription with snapshot: true
- **WHEN** an MQTT subscription request is processed with `snapshot: true`
- **THEN** the router SHALL automatically unsubscribe the MQTT client after sending the initial data replay (retained state and/or history)

