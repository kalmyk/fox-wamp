# schema-repository Specification

## Purpose
Realm-scoped persistent registry mapping canonical dotted URL patterns to immutable schemas. Each schema defines field types, primary key, and generates a dedicated SQLite projection table. Enables payload validation at publish time and typed KV projection writes.

## Requirements

### Requirement: Schema Repository Initialization
The system SHALL maintain a realm-scoped repository that maps canonical dotted URL patterns to immutable schemas.

#### Scenario: Default message handling
- **WHEN** a message is published to a URL that has no registered schema
- **THEN** the system SHALL process the message as free-form JSON without validation constraints.

### Requirement: Persistent Schema Storage
The system SHALL persist schemas and their URL mappings in realm-scoped SQLite tables named `message_schemas_${realmName}`.

#### Scenario: Storing a new schema
- **WHEN** a new schema is registered
- **THEN** the system SHALL store `schema_id`, `name`, `url_pattern`, `data_table`, `schema_json`, `status`, and `created_at` in the realm-scoped schema table.
- **AND** `url_pattern` SHALL be stored as canonical dotted FOX topic text parsed by `defaultParse()`, not MQTT slash syntax.

#### Scenario: Keeping schema rows immutable
- **GIVEN** a schema row already exists
- **WHEN** a caller needs to change its schema body, URL pattern, or generated table
- **THEN** the system SHALL create a new schema row instead of updating the existing row.

#### Scenario: Migrating TableDictionary
- **WHEN** the system initializes
- **THEN** the improved schema lookup SHALL load mappings from the realm-scoped schema repository instead of relying solely on an in-memory map.

### Requirement: Schema Body Format
The system SHALL accept the README information-schema body shape for initial schema registration.

#### Scenario: Registering README-style schema
- **WHEN** a schema body contains `properties` and `primary_key`
- **THEN** the system SHALL treat `properties` as the validated field definitions.
- **AND** the system SHALL treat `primary_key` as the generated table primary key columns.

#### Scenario: Storing aggregate hints
- **WHEN** a schema body contains aggregate or propagation fields such as `sum` or `propagate`
- **THEN** the system SHALL persist those fields as part of `schema_json`.
- **AND** the system SHALL NOT require full aggregate propagation behavior until a later implementation explicitly supports it.

### Requirement: Message Validation
The system SHALL validate incoming payloads against their corresponding schema if one is registered for the target URL.

#### Scenario: Validating a payload
- **WHEN** a message is published to a URL with a registered schema
- **THEN** the system SHALL validate the payload. If the validation fails, the message SHALL be rejected with an appropriate error event (e.g., `ValidationError`).

#### Scenario: Validating committed retained projection
- **WHEN** a committed retained event matches a KV projection linked to a schema
- **THEN** the projection listener SHALL validate the decoded event body value against the linked schema before writing projected data.

### Requirement: Auto-Provisioning Key-Value Storage
The system SHALL automatically provision a SQLite table for schemas that define key-value persistence.

#### Scenario: Provisioning storage from a schema
- **WHEN** a schema containing `properties` and `primary_key` is registered
- **THEN** the system SHALL generate and execute a `CREATE TABLE IF NOT EXISTS` statement based on the schema properties and primary key.
- **AND** the generated table name SHALL include the realm suffix.
- **AND** the generated table name SHOULD use a stable hash component to avoid coupling the physical table name to mutable display names or long URL patterns.

### Requirement: KV Storage Registration
The system SHALL register auto-provisioned key-value storages with a required schema link to ensure proper lifecycle management.

#### Scenario: Registering auto-provisioned storage
- **WHEN** a key-value SQLite table is successfully provisioned from a schema
- **THEN** the system SHALL register this new storage module in the realm-scoped `storage_desc_${realmName}` registry with the schema's `schema_id`, setting its initial status to `inactive`.
- **AND** each KV storage registry row SHALL link to exactly one schema.
- **AND** the KV storage registry SHALL use `schema_id` instead of `storage_type`.

### Requirement: Schema Replacement Lifecycle
The system SHALL replace schemas by creating new schema/data-table pairs rather than mutating existing ones.

#### Scenario: Replacing a schema
- **GIVEN** an active schema and KV projection exist for a URL pattern
- **WHEN** a modified schema is needed
- **THEN** the system SHALL create a new schema row and a new generated data table.
- **AND** the system SHALL activate the new KV projection before deactivating the old projection for that URL pattern.

#### Scenario: Removing obsolete generated table
- **GIVEN** an old schema's KV projection has been deactivated
- **WHEN** cleanup is requested
- **THEN** the system SHALL remove the generated data table associated with the old schema.
