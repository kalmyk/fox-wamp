## MODIFIED Requirements

### Requirement: Application of session-persistent KV updates
The system SHALL apply all pending KV updates associated with a session when that session disconnects, recording each change in the update history.

#### Scenario: Session disconnects with pending updates in Single DB mode
- **WHEN** a session terminates in Single DB mode
- **THEN** the system SHALL retrieve all records from `session_kv_${realmName}` where `will_sid` matches the session ID
- **THEN** for each record, the system SHALL apply the stored value to the KV storage as a new inbound event
- **THEN** the system SHALL record an entry in `update_history_${realmName}` for each applied update, using the original `msg_id` from the `session_kv` record as the origin.
- **THEN** the system SHALL remove all processed records from the `session_kv_${realmName}` table

#### Scenario: Startup recovery of stale updates in Single DB mode
- **WHEN** the router starts up in Single DB mode
- **THEN** the system SHALL retrieve ALL records from `session_kv_${realmName}`
- **THEN** for each record, the system SHALL apply the stored value to the KV storage as a new inbound event
- **THEN** the system SHALL record an entry in `update_history_${realmName}` for each applied update.
- **THEN** the system SHALL remove all processed records from the `session_kv_${realmName}` table

### Requirement: Debugging information for session-persistent updates
The system SHALL store the original message ID that created the session-persistent update record, and ensure it is preserved as the origin ID in the update history when the update is applied.

#### Scenario: Verify debug info storage and propagation
- **WHEN** a `will` update record is created in `session_kv_${realmName}`
- **THEN** the `msg_id` column SHALL contain the ID of the publish message that requested the update
- **WHEN** the session disconnects and the `will` update is applied to KV storage
- **THEN** the resulting `update_history_${realmName}` entry SHALL use the stored `msg_id` as its `msg_origin`.
