## ADDED Requirements

### Requirement: Unified update history table
The system SHALL maintain an `update_history_${realmName}` table in each realm's persistent storage to track changes to KV and Schema entities.

#### Scenario: Verify table creation
- **WHEN** a realm's persistent storage is initialized
- **THEN** the `update_history_${realmName}` table SHALL be created with the following columns: `msg_id` (update ID), `msg_origin` (originating event or command ID), `entity_type`, `entity_id`, `action`, `msg_oldv` (serialized previous state), `msg_newv` (serialized new state), and `created_at`.

### Requirement: Recording updates to persistent entities
The system SHALL record an entry in the `update_history_${realmName}` table for every change made to a persistent entity.

#### Scenario: Record KV update history
- **WHEN** a KV value is modified or deleted
- **THEN** an entry SHALL be added to `update_history_${realmName}` with `entity_type = 'kv'`.
- **AND** `entity_id` SHALL be the KV topic as canonical dotted text.
- **AND** `action` SHALL describe whether the KV entry was created, updated, or deleted.
- **AND** `msg_oldv` SHALL contain the serialized prior value, or `NULL` if it was a new key.
- **AND** `msg_newv` SHALL contain the serialized new value, or `NULL` if the key was deleted.

#### Scenario: Record Schema lifecycle history
- **WHEN** a message schema is registered, activated, or deactivated
- **THEN** an entry SHALL be added to `update_history_${realmName}` with `entity_type = 'schema'`.
- **AND** `entity_id` SHALL be the schema identifier.
- **AND** `action` SHALL describe the lifecycle operation.
- **AND** `msg_oldv` and `msg_newv` SHALL record the previous and resulting schema state or status.

#### Scenario: Record KV storage lifecycle history
- **WHEN** a KV storage projection is registered, activated, reset, or has its status changed
- **THEN** an entry SHALL be added to `update_history_${realmName}` with `entity_type = 'kv_storage'`.
- **AND** `entity_id` SHALL be the storage name.
- **AND** `action` SHALL describe the lifecycle operation.
- **AND** `msg_oldv` and `msg_newv` SHALL record the previous and resulting storage registry state.
