## 1. Admin RPC Constants and Types

- [ ] 1.1 Add `AdminEvent` namespace to `lib/masterfree/hyper.h.ts` with admin URI constants:
  `fox.admin.kv.list`, `fox.admin.kv.activate`, `fox.admin.kv.reset`,
  `fox.admin.schema.list`, `fox.admin.schema.add`.
  Keep separate from cluster `Event` enum — different semantics, different callers.
- [ ] 1.2 Define request/response body types for each admin RPC:
  - `AdminKvListRequest { realm: string }`, `AdminKvListResponse { storages: StorageRecord[] }`
  - `AdminKvActivateRequest { realm: string, name: string }`, `AdminKvActivateResponse { status: StorageStatus, activationTarget: string | null }`
  - `AdminKvResetRequest { realm: string, name: string }`, `AdminKvResetResponse { status: StorageStatus }`
  - `AdminSchemaListRequest { realm: string }`, `AdminSchemaListResponse { schemas: SchemaRecord[] }`
  - `AdminSchemaAddRequest { realm: string, label: string, urlPattern: string, schema: object }`, `AdminSchemaAddResponse { schemaId: string, dataTable: string }`

## 2. Server-side: AdminApiServer and Async Activation

- [ ] 2.1 Create `lib/masterfree/admin_api.ts` with `AdminApiServer` class.
  Constructor takes: `sysRealm: BaseRealm`, `db: sqlite.Database`, `projectionListener: ProjectionListener`, `makeId: ProduceId`.
  Provides `init()` method that registers all admin RPCs on the sys realm.
- [ ] 2.2 Register `fox.admin.kv.list` handler: reads `{ realm }`, returns `StorageRegistry.list()` for that realm.
- [ ] 2.3 Register `fox.admin.kv.activate` handler:
  - Call `registry.startActivation(name)` — sets row to `refreshing`, captures `activationTarget`, returns immediately.
  - If `status === online` return no-op `{ status: 'online', started: false }`.
  - If `status === refreshing` return error "activation already running".
  - Otherwise: fire `projectionListener._runActivation(realm, name, activationTarget)` without `await`.
  - Return `{ status: 'refreshing', activationTarget }` to caller immediately.
- [ ] 2.4 Split `ProjectionListener.activateProjection()` into two methods:
  - `startActivation(realmName, name)`: calls `registry.startActivation()`, fires `_runActivation()` without `await`, returns `StorageActivation` immediately.
  - `_runActivation(realmName, name, activationTarget)`: private async method; does history scan, calls `projection.advancePosition()` on each event, sets status to `online` on completion or `failed` + `last_error` on error. `.catch()` logs and writes failure to registry.
- [ ] 2.5 Register `fox.admin.kv.reset` handler: reads `{ realm, name }`, calls `ProjectionListener.resetProjection(realm, name)`, returns `{ status: 'inactive' }`.
- [ ] 2.6 Register `fox.admin.schema.list` handler: reads `{ realm }`, returns `SchemaRepository.list()` for that realm.
- [ ] 2.7 Register `fox.admin.schema.add` handler: reads `{ realm, label, urlPattern, schema }`, calls `SchemaRepository.register(label, urlPattern, schemaJson)`, creates the generated data table, returns `{ schemaId, dataTable }`.
- [ ] 2.8 Wire `AdminApiServer` into `bin/singledb.js` startup: construct after `ProjectionListener`, call `adminApi.init()` before the server starts listening.

## 3. CLI: Entry Point and Connection

- [ ] 3.1 Create `bin/foxctl.ts` as the commander-based CLI entry point.
  Global options: `--host <host>` (default `localhost`), `--port <port>` (default `1735`), `--realm <realm>` (required for most commands), `--json`.
- [ ] 3.2 Implement `connectAdmin(opts)`: wraps `HyperNetClient` connect + login to `'sys'` realm. Returns a connected client ready for `callrpc`.
- [ ] 3.3 Implement `withAdmin(opts, fn)`: runs `fn(client)`, then always disconnects. On error: print to stderr, `process.exit(1)`.

## 4. `foxctl kv` Commands

- [ ] 4.1 Implement `foxctl kv list`:
  Calls `fox.admin.kv.list { realm }`.
  Default: ASCII table with columns `name | status | current_position | last_error`.
  `--json`: raw JSON array.
- [ ] 4.2 Implement `foxctl kv activate <name>`:
  Calls `fox.admin.kv.activate { realm, name }`.
  Server returns immediately with `{ status: 'refreshing' }`.
  CLI prints: `Activation started: <name> → refreshing` and `Track progress: foxctl kv list --realm <realm>`.
  `--wait` flag: polls `fox.admin.kv.list` every 2s until status is `online` or `failed`, then exits with code 0 or 1.
- [ ] 4.3 Implement `foxctl kv reset <name>`:
  Calls `fox.admin.kv.reset { realm, name }`.
  Output: `<name> reset to inactive`.

## 5. `foxctl schema` Commands

- [ ] 5.1 Implement `foxctl schema list`:
  Calls `fox.admin.schema.list { realm }`.
  Default: ASCII table with columns `schema_id | label | url_pattern | data_table | status`.
  `--json`: raw JSON array.
- [ ] 5.2 Implement `foxctl schema add <label> <file.json>`:
  Reads JSON file from disk.
  Extracts `url_pattern` from schema body field or `--url-pattern` flag override.
  Calls `fox.admin.schema.add { realm, label, urlPattern, schema }`.
  Output: `Registered: <schema_id> → table <data_table>`.

## 6. Output Formatting

- [ ] 6.1 Implement a simple ASCII table formatter (no external deps): auto column widths, header row, separator line.
- [ ] 6.2 `--json` flag: `JSON.stringify(result, null, 2)` to stdout across all commands.
- [ ] 6.3 Errors to stderr, success to stdout. Exit 0 on success, 1 on any error.

## 7. Package Wiring

- [ ] 7.1 Add `"foxctl": "bin/foxctl.ts"` to `bin` field in `package.json`.
- [ ] 7.2 Confirm `tsconfig.json` compiles `bin/` to `out/bin/`.
- [ ] 7.3 Verify `tsx bin/foxctl.ts` works as a dev-time entry point without a pre-build step.

## 8. Verification

- [ ] 8.1 Integration test: `foxctl schema add` registers a schema; `foxctl schema list` returns it.
- [ ] 8.2 Integration test: `foxctl kv list` on an empty realm returns an empty table.
- [ ] 8.3 Integration test: `foxctl kv activate` returns `refreshing` immediately; subsequent `kv list` eventually shows `online`.
- [ ] 8.4 Integration test: `foxctl kv activate --wait` blocks until `online`, exits 0.
- [ ] 8.5 Integration test: `foxctl kv reset` returns projection to `inactive`, clears `current_position`.
- [ ] 8.6 Integration test: `--json` flag produces valid, parseable JSON for `kv list` and `schema list`.
- [ ] 8.7 Error case: unknown realm → descriptive error on stderr, exit 1.
- [ ] 8.8 Error case: server not running → connection error message on stderr, exit 1.
