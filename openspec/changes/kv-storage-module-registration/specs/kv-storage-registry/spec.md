## ADDED Requirements

### Requirement: KV Storage Registration
The system SHALL maintain a persistent registry of key-value projection modules to manage their lifecycle and committed-event position.

#### Scenario: Registering a new storage
- **WHEN** a persistent KV projection is initialized for the first time
- **THEN** the system SHALL create a record in the realm-scoped `kv_storages_${realmName}` table with its `name`, `uri_pattern`, `storage_type`, and initial `status` as `inactive`.
- **AND** the projection realm SHALL be represented by the registry table name, not by a `realm_name` row column.
- **AND** `uri_pattern` SHALL be stored as canonical dotted FOX topic text parsed by `defaultParse()`, not MQTT slash syntax.

#### Scenario: Preserving position during idempotent registration
- **GIVEN** a KV projection already has a realm-scoped registry record with `current_position` set
- **WHEN** the same projection is registered during restart
- **THEN** the system SHALL NOT reset `current_position`.

### Requirement: Storage Lifecycle Status
The system SHALL track the operational state of each registered KV projection module.

#### Scenario: Remaining inactive after registration
- **WHEN** a KV projection is registered
- **THEN** the system SHALL set its status to `inactive`.
- **AND** the system SHALL NOT apply historical events for that projection until an activation command is received.

#### Scenario: Transitioning to refreshing
- **WHEN** an activation command starts synchronization or data loading for a projection
- **THEN** the system SHALL update its status to `refreshing` and record the current timestamp in `started_at`.
- **AND** the system SHALL clear `last_error`.

#### Scenario: Transitioning to online
- **WHEN** a projection completes synchronization through the realm-scoped activation target and is ready to apply later committed segments
- **THEN** the system SHALL update its status to `online`.

#### Scenario: Transitioning to failed
- **WHEN** a projection fails while applying historical events during activation
- **THEN** the system SHALL update its status to `failed`.
- **AND** the system SHALL store the failure message in `last_error`.

### Requirement: Projection Activation
The system SHALL provide a dedicated command to activate a registered KV projection.

#### Scenario: Capturing realm-scoped activation target
- **GIVEN** a dbnode has committed events for multiple realms in the latest resolved segment
- **WHEN** the activation command is received for a KV projection in realm `REALM_A`
- **THEN** the system SHALL select the activation target as the latest committed event ID for `REALM_A`.
- **AND** the system SHALL NOT use an event ID from another realm as the activation target.

#### Scenario: Activating a registered projection
- **GIVEN** a KV projection is registered with status `inactive`
- **WHEN** the activation command is received for that projection
- **THEN** the system SHALL read committed history events related to the registry table's realm and the projection's `uri_pattern`.
- **AND** the system SHALL apply matching KV mutations in committed event order.
- **AND** the system SHALL keep the projection status as `refreshing` until it reaches the realm-scoped activation target observed for activation.

#### Scenario: Retrying activation after failure
- **GIVEN** a KV projection is registered with status `failed`
- **WHEN** the activation command is received for that projection
- **THEN** the system SHALL start activation from the stored `current_position`.

#### Scenario: Rejecting duplicate activation
- **GIVEN** a KV projection is registered with status `refreshing`
- **WHEN** the activation command is received for that projection
- **THEN** the system SHALL reject the command as already running.

#### Scenario: Activating an online projection
- **GIVEN** a KV projection is registered with status `online`
- **WHEN** the activation command is received for that projection
- **THEN** the system SHALL return success without replaying history.

#### Scenario: Completing activation
- **GIVEN** a projection activation has applied all related events through the activation target position
- **WHEN** there are no unapplied related events up to that position
- **THEN** the system SHALL set the projection status to `online`.

#### Scenario: Activating an empty realm
- **GIVEN** a projection's realm has no committed events at activation time
- **WHEN** the activation command completes
- **THEN** the system SHALL set the projection status to `online`.
- **AND** the system SHALL leave `current_position` as `NULL`.

#### Scenario: Resetting a projection
- **WHEN** a reset command is received for a KV projection
- **THEN** the system SHALL clear the projected KV data for that storage.
- **AND** the system SHALL set `current_position` to `NULL`.
- **AND** the system SHALL clear `last_error`.
- **AND** the system SHALL set the projection status to `inactive`.
- **AND** the system SHALL NOT start activation automatically.

### Requirement: Committed Segment Projection
The system SHALL update persistent KV projections only from committed segment visibility.

#### Scenario: Assigning committed event IDs
- **WHEN** a storage node commits events from a resolved segment
- **THEN** each committed event ID SHALL be a text value composed from the resolved string segment ID followed by the string event offset within that segment.

#### Scenario: Comparing committed event IDs
- **WHEN** activation or catch-up compares committed event positions
- **THEN** the system SHALL compare event IDs as strings.
- **AND** the system SHALL rely on the generated ID string ordering instead of parsing segment and offset parts for ordering.

#### Scenario: Ordering committed segment IDs with event IDs
- **WHEN** a new segment is committed
- **THEN** its segment ID SHALL compare greater than previous message IDs and previous segment IDs as a string.

#### Scenario: Emitting committed segment records
- **WHEN** a storage node commits a resolved segment to history
- **THEN** `SEGMENT_COMMITTED` SHALL emit `advanceOwner`, `advanceSegment`, `segment`, and the committed event records with their assigned `eventId`, `realm`, `uri`, `data`, `opt`, `sid`, and `shard`.
- **AND** each committed event `uri` SHALL use the internal `string[]` topic representation.

#### Scenario: Advancing online projection position on segment commit
- **GIVEN** a KV projection is `online`
- **WHEN** any segment is committed
- **THEN** the system SHALL advance the projection's `current_position` watermark to at least the committed segment ID.
- **AND** matching KV mutations in the committed segment SHALL still be applied using their committed event IDs.

#### Scenario: Selecting retained event projections
- **GIVEN** a committed event has `opt.retain` set to `true`
- **WHEN** the event realm selects the registry table containing a registered projection
- **AND** the event URI matches the projection's `uri_pattern`
- **THEN** the system SHALL apply the event to that projection.

#### Scenario: Applying retained event to multiple projections
- **GIVEN** a committed retained event matches more than one registered projection
- **WHEN** the projection listener processes the committed event
- **THEN** the system SHALL apply the event to each matching projection.

#### Scenario: Ignoring retained event without matching projection
- **GIVEN** a committed event has `opt.retain` set to `true`
- **WHEN** the event does not match any registered projection for its realm and URI
- **THEN** the system SHALL NOT write projected KV state for that event.

#### Scenario: Validating projected retained value
- **GIVEN** a committed retained event matches a projection whose accepted URL has a registered schema
- **WHEN** the projection listener processes the event
- **THEN** the system SHALL validate the event body value against that schema before storing it.

#### Scenario: Deleting retained row with empty value
- **GIVEN** a committed retained event matches a registered projection
- **WHEN** `isDataEmpty(event.data)` is true after normal body decoding
- **THEN** the system SHALL delete the retained row from the projection instead of storing a value.

#### Scenario: Accepting MQTT null delete
- **GIVEN** an MQTT retained publish has an empty payload
- **WHEN** the MQTT gate maps that payload to `null`
- **AND** the committed event matches a registered projection
- **THEN** the system SHALL accept the `null` value as an empty value for retained row deletion.

#### Scenario: Applying retained KV mutation after commit
- **GIVEN** a committed segment event contains a retained KV mutation matching a registered projection
- **WHEN** the projection listener receives the `SEGMENT_COMMITTED` payload
- **THEN** the projection SHALL apply the mutation to persistent KV state.

#### Scenario: Ignoring non-retained committed events
- **GIVEN** a committed segment event does not have `opt.retain` set to `true`
- **WHEN** the projection listener receives the `SEGMENT_COMMITTED` payload
- **THEN** the projection SHALL leave persistent KV state unchanged for that event.

### Requirement: Text Event Position Tracking
The system SHALL persist the committed event or segment watermark reached by each KV projection as text.

#### Scenario: Updating processed position
- **WHEN** a KV projection successfully inspects or applies a committed event with ID `EVENT_ID`
- **THEN** the system SHALL update `current_position` in the registry for that projection to `EVENT_ID`.

#### Scenario: Updating idle online position
- **GIVEN** an online KV projection receives a committed segment with no matching KV mutation
- **WHEN** the segment commit is processed
- **THEN** the system SHALL update `current_position` in the registry for that projection to the committed segment ID.
