## Requirements

### Requirement: Distributed retained event synchronization
In distributed mode, synchronization for `after` is achieved by waiting for the local Key-Value projection to be updated from resolved segments.

#### Scenario: Distributed sync wait
- **WHEN** a subscription is made on an entry node with `retained: true` and `after: "REMOTE_EVENT_999"`
- **THEN** the node SHALL wait until its local Key-Value storage projection has applied changes from resolved segments up to at least `"REMOTE_EVENT_999"` before fetching and sending the retained state.
- **AND** the subscription SHALL remain active and deliver matching live events during this wait.
