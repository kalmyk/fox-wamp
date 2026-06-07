## Context

Managing message schemas and inspecting the state of key-value storages currently requires manual database querying or writing ad-hoc scripts. As the FOX-WAMP ecosystem evolves with the introduction of the `SchemaRepository` and `kv-storage-registry`, a dedicated administrative tool is necessary to streamline these operations, ensuring consistency and ease of use for operators and developers.

## Goals / Non-Goals

**Goals:**
- Provide a dedicated CLI tool (`foxctl`) built with the `commander` package.
- Enable CRUD operations on message schemas and URL bindings.
- Enable querying and management of KV storage module statuses and synchronization positions.
- Provide human-readable outputs (such as tables and formatted JSON) for easy inspection in the terminal.

**Non-Goals:**
- Interactive REPL (Read-Eval-Print Loop) mode.
- Direct manipulation of the raw key-value data inside the user-defined tables (the scope is restricted strictly to metadata and schema management).
- Full monitoring dashboard replacement (basic status checks only).

## Decisions

### 1. Connection Strategy
`foxctl` will connect to the FOX-WAMP server using the `fox-api` connectivity protocol to execute administrative operations (e.g., managing schemas and kv-storages). 

- **Rationale**: Connecting via `fox-api` ensures that changes are dynamically propagated through the running system and applied to in-memory caches or active modules. Modifying the SQLite files directly while the server is running risks database locks, state corruption, or missing cache invalidations.
- **Alternatives**: Direct SQLite manipulation (too risky for a live system), HTTP API (using `fox-api` is more idiomatic for FOX-WAMP's ecosystem).

### 2. Command Structure
The CLI will utilize subcommands to categorize operations logically:

**Schema Management (`foxctl schema`)**
- `foxctl schema add <name> <file.json>`: Uploads a new JSON schema or updates an existing one.
- `foxctl schema list`: Outputs a table of all registered schemas and their associated IDs.
- `foxctl schema bind <name> <url_pattern>`: Binds an existing schema to a specific URL pattern.
- `foxctl schema unbind <url_pattern>`: Removes the schema binding for a URL.
- `foxctl schema delete <name>`: Deletes a schema (must be unbound first).

**KV Storage Management (`foxctl kv`)**
- `foxctl kv list`: Displays a table of all registered KV storages, including their `name`, `status`, `current_position`, and `last_error`.
- `foxctl kv activate <name>`: Sends the dedicated activation command for a registered storage. The server changes the storage to `refreshing`, applies related committed events, then changes it to `online` or `failed`.
- `foxctl kv reset <name>`: Clears the projected KV data for the storage, sets `current_position` to `NULL`, clears `last_error`, and changes its status to `inactive`. A subsequent `foxctl kv activate <name>` performs the rebuild from committed history.
- `foxctl kv delete <name>`: Deregisters a storage module (removes metadata).

### 3. Output Formatting
All list commands will default to a table-formatted output for optimal readability. When piping to other tools or debugging, a `--json` flag should be supported across all commands to output raw JSON arrays or objects.

## Risks / Trade-offs

- **[Risk] Security and Unauthorized Access** → Exposing administrative operations on the message router could allow malicious actors to alter schemas, potentially crashing validators or exposing data.
    - **Mitigation**: The administrative operations must be restricted. This can be achieved by requiring strong authentication within the `fox-api` connection or restricting caller permissions for administrative URIs.
- **[Risk] Server Dependency** → Since `foxctl` relies on `fox-api`, the FOX-WAMP server must be online for the utility to function.
    - **Mitigation**: This is considered an acceptable trade-off for the consistency guarantees it provides. Administrators who need offline recovery tools may still use standard `sqlite3` CLI tools directly on the database file in emergency scenarios.

## Open Questions

### Command Alignment

`foxctl` command names and tasks should align with the final Hyper/FOX administrative command surface defined by the schema repository and KV storage registry proposals.

- What exact server command backs schema registration?
- What exact server command backs schema deactivation?
- What exact server command backs generated table cleanup?
- What exact server command backs KV projection activation?
- What exact server command backs KV projection reset?
- What exact server command backs KV projection status/list?

### Pending Tasks

Once command names, payloads, and result shapes are clarified, add concrete implementation tasks for:

- `schema register`
- `schema deactivate`
- `schema cleanup`
- `kv activate`
- `kv reset`
- `kv status/list`
