## ADDED Requirements

### Requirement: Unified update history table
The system SHALL maintain an `update_history_${realmName}` table in each realm's persistent storage to track changes to KV and Schema entities.

#### Scenario: Verify table creation
- **WHEN** a realm's persistent storage is initialized
- **THEN** the `update_history_${realmName}` table SHALL be created with the following columns: `msg_id`, `old_updated_by_msg_id`, `entity_type`, `entity_id`, `entity_uri`, `action`, `msg_oldv`, and `msg_newv`.
- **AND** the primary key SHALL be `(entity_uri, msg_id)`.

### Requirement: Causal linking of updates
The system SHALL preserve a causal chain for every persistent entity by recording the previous update's ID.

#### Scenario: Chain KV updates
- **WHEN** a KV value is modified
- **THEN** the system SHALL fetch the current `updated_by_msg_id` from the `kv_${realmName}` table.
- **AND** the system SHALL record this as `old_updated_by_msg_id` in the new history entry.
- **AND** the system SHALL update `kv_${realmName}` with the new `msg_id`.

### Requirement: Recording updates to persistent entities
The system SHALL record an entry in the `update_history_${realmName}` table for every change made to a persistent entity.

#### Scenario: Record KV update history
- **WHEN** a KV value is modified or deleted
- **THEN** an entry SHALL be added to `update_history_${realmName}` with `entity_type = 'kv'`.
- **AND** `entity_uri` SHALL be the KV topic as canonical dotted text.
- **AND** `action` SHALL describe whether the KV entry was created, updated, or deleted.
- **AND** `msg_oldv` SHALL contain the serialized prior value, or `NULL` if it was a new key.
- **AND** `msg_newv` SHALL contain the serialized new value, or `NULL` if the key was deleted.
