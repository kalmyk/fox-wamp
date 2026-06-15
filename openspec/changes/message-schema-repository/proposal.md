## Why

Persistent retained projections need an explicit schema registry so incoming events can be validated before they are stored, and so SQLite projection tables can be generated from a durable schema definition instead of ad hoc code.

The current KV registry has a `storage_type` placeholder, but persistent KV projections should be linked to a concrete schema. That schema defines the accepted URL pattern, validation rules, and the generated SQLite table used by the projection.

## What Changes

- Add a realm-scoped schema repository table that stores immutable schema records.
- Use the README information-schema shape as the initial schema body format: `properties`, `primary_key`, optional aggregate/projection fields such as `sum` and `propagate`.
- Bind each schema record to an accepted URL prefix/pattern stored as canonical dotted FOX topic text.
- Require schema registration inputs to use canonical dotted FOX topic prefixes/patterns only. Protocol gates normalize MQTT slash topics and WAMP dotted topics into this same canonical dotted FOX topic form before schema lookup.
- Generate a related SQLite data table for each schema, with a `${realmName}` suffix and a stable hash-derived table name.
- Link each `kv_storage_${realmName}` row to exactly one schema via `schema_id`; this replaces the current `storage_type` placeholder in the KV registry proposal.
- Validate incoming committed retained events against every matching schema before storing projected data. MQTT and WAMP follow the same schema-selection rules after protocol-boundary parsing.
- Apply each matching schema's projection rules independently. A schema owns its generated projection table set, so overlapping schema URL prefixes/patterns are allowed and are not inherently dangerous.
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

## Open Questions

### Retained Delete Key Source

The system will support URI-derived primary keys. If a retained delete event (empty payload) is received, the primary key values will be extracted from the topic URI based on a mapping defined in the schema.

The schema must include a `key_from_uri` object mapping primary key fields to their respective indices in the canonical dotted FOX topic path.

Example:
```json
{
  "properties": {
    "user_id": "string",
    "username": "string",
    "email": "string"
  },
  "primary_key": ["user_id"],
  "key_from_uri": {
    "user_id": 2
  }
}
```
In the topic `profiles/123`, the value `123` at index 2 is mapped to `user_id`, allowing the system to identify and delete the correct row.

### Schema Replacement Lifecycle

Schema replacement currently creates a new immutable schema row/table, activates a new projection, deactivates the old projection, and later cleans up the old generated table. Overlapping schemas are allowed because each matching schema validates/applies its own projection rules independently and owns its generated projection table set. The remaining lookup and lifecycle details still need a precise contract.

- Can two active schemas share the exact same `url_pattern` during transition, or is overlap allowed only between different prefixes/patterns?
- If two schema rows share the exact same URL pattern, does lookup apply both independently or does replacement require one to be deprecated first?
- What field or status marks the old schema/projection as deprecated or inactive for lookup?
- Is cleanup of obsolete generated tables manual only, or can it be triggered automatically after deactivation?

### Primary Key and Table Projection Model

Generated table creation defines columns from schema `properties`, but projection write behavior needs an exact rule.

- Does the projection always upsert by the generated table `primary_key`?
- Must every primary-key field come from the decoded event body unless `key_from_uri` or an equivalent mapping is defined?
- What happens when a retained event matches the schema URL pattern but does not provide all required primary-key values?
- Is the retained topic URI stored as projection metadata, or is the generated table key the only row identity?
