# Spec Delta

## MODIFIED Requirements

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
- **THEN** `SEGMENT_COMMITTED` SHALL emit `advanceOwner`, `advanceStamp`, `segment`, and the committed event records with their assigned `eventId`, `realm`, `uri`, `data`, `opt`, `sid`, and `shard`.
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

#### Scenario: Ignoring committed conditional requests
- **GIVEN** a committed segment event carries a `when` condition
- **WHEN** the projection listener receives the `SEGMENT_COMMITTED` payload
- **THEN** the projection SHALL NOT apply the request itself to persistent KV state
- **AND** the projection SHALL apply only the effect produced by conditional evaluation, as defined in `replicated-conditional-kv`

#### Scenario: Applying a conditional effect
- **GIVEN** conditional evaluation yields an `applied` effect, or a fired-waiter effect with a derived event ID, for a URI matching a registered projection
- **WHEN** the projection listener processes that effect
- **THEN** the projection SHALL apply the effect's value to persistent KV state using the effect's event ID

### Requirement: Text Event Position Tracking
The system SHALL persist the committed event or segment watermark reached by each KV projection as text.

#### Scenario: Updating processed position
- **WHEN** a KV projection successfully inspects or applies a committed event with ID `EVENT_ID`
- **THEN** the system SHALL update `current_position` in the registry for that projection to `EVENT_ID`.

#### Scenario: Updating idle online position
- **GIVEN** an online KV projection receives a committed segment with no matching KV mutation
- **WHEN** the segment commit is processed
- **THEN** the system SHALL update `current_position` in the registry for that projection to the committed segment ID.

#### Scenario: Recording a derived event ID as position
- **WHEN** a KV projection applies a fired-waiter effect with a derived event ID
- **THEN** the system SHALL store that derived event ID as `current_position`
- **AND** resuming from that position SHALL compare IDs as strings, without parsing derived suffixes
