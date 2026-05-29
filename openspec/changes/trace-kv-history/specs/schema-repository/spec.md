## MODIFIED Requirements

### Requirement: Persistent Schema Storage
The system SHALL persist schemas and their URL mappings in realm-scoped SQLite tables named `message_schemas_${realmName}`, and record each registration in the update history.

#### Scenario: Storing a new schema with history
- **WHEN** a new schema is registered
- **THEN** the system SHALL store `schema_id`, `name`, `url_pattern`, `data_table`, `schema_json`, `status`, and `created_at` in the realm-scoped schema table.
- **AND** the system SHALL record an entry in `update_history_${realmName}` using the `schema_id` as the identifier and recording the registration event.
- **AND** `url_pattern` SHALL be stored as canonical dotted FOX topic text parsed by `defaultParse()`, not MQTT slash syntax.

### Requirement: Schema Replacement Lifecycle
The system SHALL replace schemas by creating new schema/data-table pairs rather than mutating existing ones, and record activation/deactivation in history.

#### Scenario: Replacing a schema with history
- **GIVEN** an active schema and KV projection exist for a URL pattern
- **WHEN** a modified schema is needed
- **THEN** the system SHALL create a new schema row and a new generated data table.
- **AND** the system SHALL activate the new KV projection before deactivating the old projection for that URL pattern.
- **AND** the system SHALL record entries in `update_history_${realmName}` for the activation of the new schema and deactivation of the old schema.
