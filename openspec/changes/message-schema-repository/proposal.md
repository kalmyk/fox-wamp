## Why

Persistent retained projections need an explicit schema registry so incoming events can be validated before they are stored, and so SQLite projection tables can be generated from a durable schema definition instead of ad hoc code.

The current KV registry has a `storage_type` placeholder, but persistent KV projections should be linked to a concrete schema. That schema defines the accepted URL pattern, validation rules, and the generated SQLite table used by the projection.

## What Changes

- Add a realm-scoped schema repository table that stores immutable schema records.
- Use the README information-schema shape as the initial schema body format: `properties`, `primary_key`, optional aggregate/projection fields such as `sum` and `propagate`.
- Bind each schema record to an accepted URL pattern stored as canonical dotted FOX topic text.
- Generate a related SQLite data table for each schema, with a `${realmName}` suffix and a stable hash-derived table name.
- Link each `kv_storages_${realmName}` row to exactly one schema via `schema_id`; this replaces the current `storage_type` placeholder in the KV registry proposal.
- Validate incoming committed retained events against the schema selected by URL before storing projected data.
- Treat schemas and generated data tables as immutable for now. To modify a schema, create a new schema record, create a new generated table, activate the new KV projection, deactivate the old one, and then remove the old generated data table when it is no longer needed.

## Capabilities

### New Capabilities

- `schema-repository`: Persistent schema registration, URL-to-schema lookup, generated SQLite table ownership, and validation rules for retained KV projections.

### Modified Capabilities

- `kv-storage-registry`: KV storage records are linked to a required `schema_id` instead of a generic `storage_type`.

## Impact

- New SQLite schema repository module and generated table naming helper.
- Updates to `kv-storage-module-registration` schema/tasks to replace `storage_type` with `schema_id`.
- Updates to retained projection activation/listener code so projected values are validated against the linked schema before writes.
- Future `foxctl` commands need schema registration, activation/deactivation flow, and cleanup for obsolete generated data tables.
