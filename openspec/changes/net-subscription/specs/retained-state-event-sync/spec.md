# retained-state-event-sync — delta spec

## MODIFIED Requirements

### Requirement: Distributed mode supports after-based history replay

The system SHALL support `after`-based history replay for subscriptions on distributed realms (`NetEngine`) when at least one storage node is connected.

#### Scenario: Distributed subscription with after delivers history

- **WHEN** a WAMP client sends `SUBSCRIBE` with `options.after = 'EVT_X'` on a distributed realm
- **AND** at least one storage node is connected and has announced via `STORAGE_NODE_CONNECTED`
- **THEN** the entry node SHALL fetch events from storage via `fox.storage.history.fetch`
- **AND** SHALL deliver all events with `event_id > 'EVT_X'` to the subscriber before enabling live delivery

#### Scenario: No storage node connected — history unavailable

- **WHEN** a WAMP client sends `SUBSCRIBE` with `options.after` on a distributed realm
- **AND** no storage node has connected (announced)
- **THEN** `NetEngine.supportsRetainedEventSync` SHALL be `false`
- **AND** the router SHALL reject or skip history replay as per existing gating behavior (same as before this change)

#### Scenario: Storage node connects after subscription

- **WHEN** a subscriber with `after` is waiting and no storage node is connected
- **AND** a storage node subsequently connects
- **THEN** the replay SHALL begin automatically once `supportsRetainedEventSync` becomes `true`
  (out of scope for MVP — subscription may need to be re-issued; log a warning)
