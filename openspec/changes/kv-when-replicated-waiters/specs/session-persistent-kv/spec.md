# Spec Delta

## MODIFIED Requirements

### Requirement: Conditional KV updates (Optimistic Locking)
The system SHALL support the `when` attribute in publish messages to perform conditional updates.

#### Scenario: Successful conditional update
- **WHEN** a publish includes `when: { status: 'idle' }` and the current value in storage matches that condition
- **THEN** the system SHALL apply the update and acknowledge the publish

#### Scenario: Failed conditional update without watch
- **WHEN** a publish includes `when: { status: 'idle' }`, the current value is NOT 'idle', and `watch` is false
- **THEN** the system SHALL reject the publish immediately with an error

#### Scenario: Conditional update in distributed mode
- **WHEN** a publish includes `when` and is sent through an entry node in distributed mode
- **THEN** the condition SHALL be evaluated by the KV replicas against committed state as defined in `replicated-conditional-kv`
- **AND** the publish SHALL be acknowledged or rejected only after the replicas report the outcome

### Requirement: Reactive Waiting (Watch)
The system SHALL support the `watch` attribute to wait for a condition to be met before applying an update.

#### Scenario: Parking a publish with watch
- **WHEN** a publish includes `when` and `watch: true`, and the condition is NOT met
- **THEN** the system SHALL park the publish and delay acknowledgment until the condition is met by another update
- **THEN** if multiple sessions are watching the same value, only the first one to be satisfied SHALL succeed (mutex behavior)

#### Scenario: Parked publish held as data
- **WHEN** a publish is parked in any engine (in-memory, single SQLite or distributed)
- **THEN** the system SHALL hold it as a waiter record identifying the entry, session and actor, not as a reference to the live request object

#### Scenario: Parked publish dropped on session close
- **GIVEN** a session has parked publishes
- **WHEN** that session terminates
- **THEN** the system SHALL remove its waiter records without applying them

### Requirement: Application of session-persistent KV updates
The system SHALL apply all pending KV updates associated with a session when that session disconnects.

#### Scenario: Session disconnects with pending updates in Single DB mode
- **WHEN** a session terminates in Single DB mode
- **THEN** the system SHALL retrieve all records from `session_kv_${realmName}` where `will_sid` matches the session ID
- **THEN** for each record, the system SHALL apply the stored value to the KV storage as a new inbound event
- **THEN** the system SHALL remove all processed records from the `session_kv_${realmName}` table

#### Scenario: Startup recovery of stale updates in Single DB mode
- **WHEN** the router starts up in Single DB mode
- **THEN** the system SHALL retrieve ALL records from `session_kv_${realmName}`
- **THEN** for each record, the system SHALL apply the stored value to the KV storage as a new inbound event
- **THEN** the system SHALL remove all processed records from the `session_kv_${realmName}` table

#### Scenario: Session disconnects with pending updates in the in-memory engine
- **WHEN** a session terminates in the in-memory engine
- **THEN** the system SHALL apply each `will` record registered by that session from the stored record data, without calling back into the session's request objects
- **AND** the system SHALL remove those records

#### Scenario: Session disconnects in distributed mode
- **WHEN** a session connected to an entry node terminates in distributed mode
- **THEN** a `SESSION_LEAVE` carrying the entry id and session id SHALL be committed to history, as defined in `session-lifecycle`
- **AND** at that event's eventId every KV replica SHALL drop the session's waiter records and apply its `will` records

#### Scenario: Entry lost in distributed mode
- **WHEN** an entry node is lost and the sync cluster commits `SESSION_LEAVE` events for its sessions
- **THEN** every KV replica SHALL drop those sessions' waiter records and apply their `will` records at each LEAVE's eventId
- **AND** every replica SHALL produce the same resulting KV values
