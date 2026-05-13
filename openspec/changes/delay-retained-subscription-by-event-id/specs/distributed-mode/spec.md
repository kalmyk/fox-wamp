## ADDED Requirements

### Requirement: Distributed retained event synchronization design gate
Distributed mode SHALL NOT claim full `after_event_id` support until the implementation defines an entry-visible retained-storage commit signal for locally served subscriptions.

#### Scenario: Distributed sync remains explicitly gated
- **WHEN** a subscription is made on Node A with `after_event_id: "REMOTE_EVENT_999"`
- **AND** Node A is using distributed mode
- **AND** Node A cannot verify that retained storage has committed and exposed `REMOTE_EVENT_999` to retained lookup
- **THEN** Node A SHALL reject the subscription with an unsupported-option WAMP error

#### Scenario: Future distributed sync wait
- **WHEN** distributed support is implemented
- **AND** a subscription is made on Node A with `retained: true` and `after_event_id: "REMOTE_EVENT_999"`
- **THEN** Node A SHALL wait until its local retained-state lookup path can observe state committed through `REMOTE_EVENT_999` before fetching and sending retained state.
