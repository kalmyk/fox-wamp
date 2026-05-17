# session-persistent-kv Specification

## Purpose
TBD - created by archiving change session-kv-single-db. Update Purpose after archive.
## Requirements
### Requirement: Session-persistent KV update registration
The system SHALL support registering a Key-Value update that is deferred until the session that registered it disconnects. This is triggered by a `publish` message containing a `will` attribute.

#### Scenario: Registering a will update in Single DB mode
- **WHEN** a client publishes to a KV topic with a `will` attribute in Single DB mode
- **THEN** the system SHALL store the `will` payload, the target key, the session ID, and the originating message ID in the `session_kv_${realmName}` table

#### Scenario: Will cleanup on subsequent publish
- **WHEN** any client publishes to a key that has an existing `will` registration (even from a different session)
- **THEN** the system SHALL remove the existing `will` registration from the `session_kv_${realmName}` table

### Requirement: Conditional KV updates (Optimistic Locking)
The system SHALL support the `when` attribute in publish messages to perform conditional updates.

#### Scenario: Successful conditional update
- **WHEN** a publish includes `when: { status: 'idle' }` and the current value in storage matches that condition
- **THEN** the system SHALL apply the update and acknowledge the publish

#### Scenario: Failed conditional update without watch
- **WHEN** a publish includes `when: { status: 'idle' }`, the current value is NOT 'idle', and `watch` is false
- **THEN** the system SHALL reject the publish immediately with an error

### Requirement: Reactive Waiting (Watch)
The system SHALL support the `watch` attribute to wait for a condition to be met before applying an update.

#### Scenario: Parking a publish with watch
- **WHEN** a publish includes `when` and `watch: true`, and the condition is NOT met
- **THEN** the system SHALL park the publish and delay acknowledgment until the condition is met by another update
- **THEN** if multiple sessions are watching the same value, only the first one to be satisfied SHALL succeed (mutex behavior)

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

### Requirement: Debugging information for session-persistent updates
The system SHALL store the original message ID that created the session-persistent update record.

#### Scenario: Verify debug info storage
- **WHEN** a `will` update record is created in `session_kv_${realmName}`
- **THEN** the `msg_id` column SHALL contain the ID of the publish message that requested the update

