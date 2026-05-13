## ADDED Requirements

### Requirement: Distributed event synchronization for subscriptions
In distributed mode, when a subscription with `after_event_id` is made, the synchronization SHALL ensure that the `after_event_id` is locally visible in the storage before the retained state is fetched.

#### Scenario: Distributed sync wait
- **WHEN** a subscription is made on Node A with `after_event_id: "REMOTE_EVENT_999"`
- **THEN** Node A SHALL wait until its local storage has committed `REMOTE_EVENT_999` (via the `ADVANCE_SEGMENT_RESOLVED` flow) before fetching and sending retained state.
