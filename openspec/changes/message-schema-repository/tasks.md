## 1. Schema Repository Tables

- [x] 1.1 Add realm-scoped `message_schemas_${realmName}` table creation logic.
- [x] 1.2 Define schema record types with `schema_id`, `label`, `url_pattern`, `data_table`, `schema_json`, `status`, and `created_at`.
- [x] 1.3 Implement immutable schema registration that rejects in-place updates to schema body, URL pattern, or generated table.
- [x] 1.4 Store `url_pattern` as canonical dotted FOX topic text and parse it with `defaultParse()` when matching events.

## 2. Schema Body and Validation

- [x] 2.1 Implement validation for the README-style schema body shape with `properties` and `primary_key`.
- [x] 2.2 Persist optional aggregate/projection hints such as `sum` and `propagate` without requiring full aggregate behavior.
- [x] 2.3 Validate incoming publish payloads against the schema selected by URL pattern.
- [x] 2.4 Validate decoded committed retained values against the KV projection's linked schema before projected storage writes, supporting URI-derived primary keys via `key_from_uri`.

## 3. Generated SQLite Tables

- [x] 3.1 Add a stable generated table naming helper that includes a schema hash and `${realmName}` suffix.
- [x] 3.2 Generate `CREATE TABLE IF NOT EXISTS` SQL from schema `properties` and `primary_key`.
- [x] 3.3 Store the generated table name in the schema repository row.
- [ ] 3.4 Add cleanup logic to remove obsolete generated data tables only after the old projection is deactivated.

## 4. KV Registry Integration

- [x] 4.1 Update `kv-storage-module-registration` artifacts to replace `storage_type` with required `schema_id`.
- [x] 4.2 Update `StorageRecord` and `StorageRegistry` code to persist `schema_id` instead of `storage_type`.
- [x] 4.3 Ensure every `kv_storage_${realmName}` row links to exactly one schema.
- [x] 4.4 Ensure the KV registry `uri_pattern` is compatible with the linked schema `url_pattern`.

## 5. Schema Replacement Flow

- [ ] 5.1 Add command/API path to register a new schema and generated table for a modified schema.
- [ ] 5.2 Add command/API path to activate the new KV projection.
- [ ] 5.3 Add command/API path to deactivate or reset the old KV projection.
- [ ] 5.4 Add command/API path to remove the old generated table after deactivation.

## 6. Verification

- [x] 6.1 Test schema repository table creation per realm.
- [x] 6.2 Test registering README-style schema stores an immutable schema row and generated table name.
- [x] 6.3 Test generated table name includes the realm suffix and a stable hash component.
- [x] 6.4 Test invalid payloads for schema-mapped URLs are rejected.
- [x] 6.5 Test unmapped URLs still accept free-form JSON.
- [x] 6.6 Test retained projection writes validate against linked `schema_id` and handle `key_from_uri`.
- [x] 6.7 Test KV registry rows require `schema_id` and no longer use `storage_type`.
- [ ] 6.8 Test schema replacement creates a new data table and leaves the old table untouched until cleanup.
