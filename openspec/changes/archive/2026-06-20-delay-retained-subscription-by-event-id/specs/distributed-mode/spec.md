## ADDED Requirements

### Requirement: Distributed retained event synchronization
In distributed mode, synchronization for `after` SHALL wait for the local Key-Value projection watermark to reach the requested event ID before retained state is fetched.

#### Scenario: Distributed sync wait
- **WHEN** a subscription is made on an entry node with `retained: true` and `after: "REMOTE_EVENT_999"`
- **AND** distributed retained synchronization is implemented
- **THEN** the node SHALL wait until its local Key-Value projection `kv_storage_${realmName}.current_position` has reached at least `"REMOTE_EVENT_999"`.
- **AND** the node SHALL fetch and send retained rows from that same local Key-Value projection.
- **AND** the subscription SHALL remain active and deliver matching live events during this wait.

#### Scenario: Distributed sync remains gated before projection support
- **WHEN** a subscription is made on an entry node with `retained: true` and `after: "REMOTE_EVENT_999"`
- **AND** the node cannot observe a local Key-Value projection watermark for retained lookup
- **THEN** the node SHALL reject the synchronized retained replay request as unsupported.
