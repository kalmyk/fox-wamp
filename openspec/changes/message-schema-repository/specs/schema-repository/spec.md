## ADDED Requirements

### Requirement: Schema Repository Initialization
The system SHALL maintain a repository that maps URL patterns to JSON Schemas.

#### Scenario: Default message handling
- **WHEN** a message is published to a URL that has no registered schema
- **THEN** the system SHALL process the message as free-form JSON without validation constraints.

### Requirement: Persistent Schema Storage
The system SHALL persist schemas and their URL mappings in dedicated SQLite tables (`message_schemas` and `schema_urls`).

#### Scenario: Storing a new schema
- **WHEN** a new schema is registered
- **THEN** the system SHALL store the JSON Schema in the `message_schemas` table and record the URL mapping in the `schema_urls` table.

#### Scenario: Migrating TableDictionary
- **WHEN** the system initializes
- **THEN** the improved `TableDictionary` SHALL load its mappings from the `message_schemas` and `schema_urls` tables instead of relying solely on an in-memory map.

### Requirement: Message Validation
The system SHALL validate incoming payloads against their corresponding schema if one is registered for the target URL.

#### Scenario: Validating a payload
- **WHEN** a message is published to a URL with a registered schema
- **THEN** the system SHALL validate the payload. If the validation fails, the message SHALL be rejected with an appropriate error event (e.g., `ValidationError`).

### Requirement: Auto-Provisioning Key-Value Storage
The system SHALL automatically provision a SQLite table for schemas that define key-value persistence.

#### Scenario: Provisioning storage from a schema
- **WHEN** a schema containing SQLite persistence mappings (e.g., `"x-sqlite-key"`, `"x-sqlite-value"`) is loaded for a URL
- **THEN** the system SHALL generate and execute a `CREATE TABLE IF NOT EXISTS` statement based on the mapped properties.

### Requirement: KV Storage Registration
The system SHALL register auto-provisioned key-value storages to ensure proper lifecycle management.

#### Scenario: Registering auto-provisioned storage
- **WHEN** a key-value SQLite table is successfully provisioned from a schema
- **THEN** the system SHALL register this new storage module in the `kv_storages` registry (as defined in the `kv-storage-module-registration` specification), setting its initial status to `inactive`.
