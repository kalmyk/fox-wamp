## ADDED Requirements

### Requirement: Unified update history table
The system SHALL maintain an `update_history_${realmName}` table in each realm's persistent storage to track changes to KV and Schema entities.

#### Scenario: Verify table creation
- **WHEN** a realm's persistent storage is initialized
- **THEN** the `update_history_${realmName}` table SHALL be created with the following columns: `msg_id` (update ID), `msg_origin` (originating event ID), `msg_uri` (entity identifier), and `msg_oldv` (serialized previous state).

### Requirement: Recording updates to persistent entities
The system SHALL record an entry in the `update_history_${realmName}` table for every change made to a persistent entity.

#### Scenario: Record KV update history
- **WHEN** a KV value is modified or deleted
- **THEN** an entry SHALL be added to `update_history_${realmName}` containing the stable update ID, the originating message ID, the KV topic (as canonical dotted text), and the serialized prior value (or null if it was a new key).

#### Scenario: Record Schema lifecycle history
- **WHEN** a message schema is registered, activated, or deactivated
- **THEN** an entry SHALL be added to `update_history_${realmName}` using the schema identifier as the URI and recording the previous state or status.
