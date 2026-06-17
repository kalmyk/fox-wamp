## Context

In the current FOX-WAMP ecosystem, messages on any URL/topic default to free-form JSON payloads. While this provides maximum flexibility, persistent retained projections need a durable schema registry that defines which URL patterns are accepted, how incoming values are validated, and which generated SQLite table owns the projected data.

The README already contains an information-schema style example with `properties`, `primary_key`, `propagate`, and aggregate fields. This change makes that shape the initial schema body for retained projections.

## Goals / Non-Goals

**Goals:**
- Provide a realm-scoped schema repository mapping canonical dotted URL patterns to immutable schema records.
- Enable automatic payload validation for messages sent to mapped URLs.
- Retain the default behavior of accepting free-form JSON on unmapped URLs.
- Automatically provision SQLite projection tables based on defined schemas.
- Link every persistent KV storage registry row to exactly one schema.
- Support schema replacement by creating a new schema/data table and deactivating the old projection.

**Non-Goals:**
- Complex relational schema generation (foreign keys, complex joins). The scope is limited to key-value tables where the structure is derived from a flat JSON Schema.
- In-place schema or generated-table migration.
- Updating schema rows after creation.

## Decisions

### 1. Schema Repository Definition
We will replace the old in-memory `TableDictionary` responsibility with a persistent `SchemaRepository`. Repository tables are realm-scoped, matching the existing `kv_${realmName}` and proposed `kv_storage_${realmName}` naming style.

**Database Schema for the Repository:**
```sql
CREATE TABLE message_schemas_<realmName> (
    schema_id TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    url_pattern TEXT NOT NULL UNIQUE,
    data_table TEXT NOT NULL UNIQUE,
    schema_json TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active', 'deprecated')),
    created_at INTEGER NOT NULL
);
```

`url_pattern` is canonical dotted FOX topic text and is parsed with `defaultParse()` for matching. It is not MQTT slash syntax.

`schema_id` is stable and is a hash of the canonical schema definition (`sch_<realmName>_<hash>`). `data_table` is the generated SQLite table name and includes the realm suffix (`data_<realmName>_<hash>`). Hash-derived names avoid coupling physical table names to mutable labels or long URL patterns.

Schema rows are immutable. There is no update-in-place path for `schema_json`, `url_pattern`, or `data_table`.

### 2. Schema Body and URL Field Extraction
The initial schema body follows the README information-schema shape:

```json
{
  "properties": {
    "date": { "type": "string" },
    "customer": { "type": "string" },
    "amount": { "type": "string" }
  },
  "primary_key": ["date", "customer"],
  "propagate": {
    "detail": [{
      "key": ["customer"],
      "fields": { "total": "amount" },
      "filter": { "type": "sale" }
    }]
  }
}
```

**Constraint:** Every field in `primary_key` MUST be present in the `url_pattern` as a named placeholder. This ensures all primary keys have authoritative values bound to the URL structure.

The `url_pattern` uses named field placeholders in curly braces within dotted canonical FOX topic text:
- Example: `sales.{customer}.{date}` or `revenue.{region}.{year}.detail`
- Fields wrapped in `{...}` are extracted from the actual URL/topic and merged with the body payload.
- Fields NOT in the pattern must come from the body payload.

**Validation order:**
1. Extract field values from the URL using the `url_pattern` placeholder positions.
2. Merge URL-extracted values with the body payload (URL values take precedence).
3. Validate that all fields in `properties` have the correct type.
4. Validate that all fields in `primary_key` are non-null and present (after merge).

For the first implementation, `properties` and `primary_key` define validation and generated table columns. Aggregate features such as `sum` and `propagate` may be stored and validated structurally, but full aggregate behavior can remain a later implementation task unless explicitly required by a projection.

### 3. KV Registry Link
Each persistent KV projection row in `kv_storage_${realmName}` must link to one schema:

```sql
CREATE TABLE kv_storage_<realmName> (
    name TEXT PRIMARY KEY,
    schema_id TEXT NOT NULL,
    uri_pattern TEXT NOT NULL,
    started_at INTEGER,
    status TEXT NOT NULL CHECK(status IN ('inactive', 'refreshing', 'online', 'failed')) DEFAULT 'inactive',
    current_position TEXT,
    last_error TEXT
);
```

`schema_id` replaces the current `storage_type` placeholder. The projection implementation is derived from the linked schema and generated data table, not from a generic type string.

The registry `uri_pattern` must be compatible with the linked schema's `url_pattern`. The simplest valid first version is equality: one schema URL pattern maps to one KV projection accepted URL pattern.

### 4. Message Validation
When an event is received, the router will query the `SchemaRepository`.
- If no schema is found, the message is processed as free JSON.
- If a schema is found, the payload is validated against the schema body. Invalid messages are rejected before routing or storage.
- During committed retained projection, the listener validates the decoded retained value against the schema linked by the matching KV storage row before writing the generated data table.

### 5. Generated SQLite Projection Tables
When a schema is registered:
1. The system creates the corresponding SQLite table if it does not exist.
2. The table name is stored in `message_schemas_${realmName}.data_table`.
3. The generated table includes columns for schema `properties`, primary key columns from `primary_key`, and projection metadata such as event position.
4. The newly provisioned table/storage is registered via the `kv-storage-registry` API with `schema_id` and status initialized to `inactive`.
5. A separate activation command refreshes the projection from committed history and moves it to `online` after catch-up completes.

### 6. Schema Replacement Lifecycle
Schema changes do not update existing schema rows or mutate existing generated tables. To change a schema:

1. Create a new schema row with a new `schema_id` and generated `data_table`.
2. Register a new KV storage row linked to that `schema_id`.
3. A separate activation command refreshes the projection from committed history and moves it to `online` after catch-up completes.
4. Deactivate or reset the old KV storage row.
5. Remove the old generated data table only after callers no longer depend on it.

There is no automatic data migration between old and new generated tables in this change.

## Risks / Trade-offs

- **[Risk] Performance Overhead** → Synchronous schema validation on high-throughput URLs may cause latency.
    - **Mitigation**: Cache compiled JSON schemas. Allow configuration to enable/disable validation per topic in high-performance environments.
- **[Risk] Schema Evolution** → Changing a schema that maps to a SQLite table might break inserts if columns are mismatched.
    - **Mitigation**: Schemas are immutable. Any modification creates a new schema ID and generated table, then the old projection is deactivated and cleaned up.
