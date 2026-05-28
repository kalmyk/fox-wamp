## Context

In the current FOX-WAMP ecosystem, messages on any URL/topic default to free-form JSON payloads. While this provides maximum flexibility, certain enterprise use cases require strict validation of message schemas and automated structuring of data for persistence. Currently, developers must manually parse, validate, and write boilerplate code to store message fields into SQL tables.

## Goals / Non-Goals

**Goals:**
- Provide a centralized schema repository mapping URLs to JSON Schemas.
- Enable automatic payload validation for messages sent to mapped URLs.
- Retain the default behavior of accepting free-form JSON on unmapped URLs.
- Automatically provision SQLite key-value tables based on defined schemas.
- Register auto-provisioned storage modules with the `kv-storage-registry`.

**Non-Goals:**
- Complex relational schema generation (foreign keys, complex joins). The scope is limited to key-value tables where the structure is derived from a flat JSON Schema.
- On-the-fly migration of existing data when a schema changes.

## Decisions

### 1. Schema Repository Definition
We will alter and improve the existing `TableDictionary` class (located in `lib/realm.ts`) to serve as the new `SchemaRepository`. Instead of just an in-memory mapping, it will be backed by dedicated SQLite tables to persistently store schemas and link them to URLs.

**Database Schema for the Repository:**
```sql
CREATE TABLE message_schemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    schema_json TEXT NOT NULL
);

CREATE TABLE schema_urls (
    url_pattern TEXT PRIMARY KEY,
    schema_id INTEGER NOT NULL,
    FOREIGN KEY(schema_id) REFERENCES message_schemas(id)
);
```

A schema configuration will bind a specific URL or URL pattern (via the `schema_urls` table) to a valid JSON Schema (stored in the `message_schemas` table).

### 2. Message Validation
When an event is received, the router will query the `SchemaRepository`.
- If no schema is found, the message is processed as free JSON.
- If a schema is found, the payload is validated against the JSON Schema using a library like `jsonschema`. Invalid messages will be rejected before routing or storage.

### 3. Automated Key-Value Storage
Schemas that dictate persistence will define SQLite table structures via custom schema extensions (e.g., using properties like `"x-sqlite-key"` to denote primary keys).
When a schema with persistence rules is registered:
1. The system creates the corresponding SQLite table if it does not exist.
2. The newly provisioned table/storage is registered via the `kv-storage-registry` API with status initialized to `inactive`.
3. A separate activation command refreshes the projection from committed history and moves it to `online` after catch-up completes.

The exact schema extension shape is still to be finalized. The README contains an older information-schema style example with `properties`, `primary_key`, and propagation rules; the implementation should either adopt that shape or replace it with an explicitly documented JSON Schema extension before code is written. Regardless of shape, projected retained values must be validated against the matched schema before they are stored.

## Risks / Trade-offs

- **[Risk] Performance Overhead** → Synchronous schema validation on high-throughput URLs may cause latency.
    - **Mitigation**: Cache compiled JSON schemas. Allow configuration to enable/disable validation per topic in high-performance environments.
- **[Risk] Schema Evolution** → Changing a schema that maps to a SQLite table might break inserts if columns are mismatched.
    - **Mitigation**: Future proposals will need to address schema versioning. For now, schemas mapped to SQL tables are considered append-only or require manual intervention for complex migrations.
