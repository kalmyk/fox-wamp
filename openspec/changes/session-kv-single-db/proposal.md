## Why

Currently, the 'set value on disconnect' feature (using the `will` attribute of a publish message) is only fully functional in the in-memory storage mode. In Single DB mode (SQLite), while a table named `set_value_${realmName}` exists, it is not used to store these pending updates. This change ensures that persistent KV storage also supports session-tied updates, maintaining feature parity across storage modes and ensuring reliability after router restarts.

## What Changes

- **BREAKING**: Rename the existing (but unused) table `set_value_${realmName}` to `session_kv_${realmName}` in the SQLite backend.
- Update the schema of `session_kv_${realmName}` to store key, value, and session ID for pending "on-disconnect" updates.
- Modify `SqliteKvFabric` to store the `will` payload into `session_kv_${realmName}` when a publish message includes it, ensuring that only the **last** session to publish to a key owns its "will".
- Implement **Optimistic Locking (`when`)**: Support conditional updates based on the current value in storage.
- Implement **Reactive Waiting (`watch`)**: Allow sessions to wait for a specific condition (`when`) to be met before their publish is applied and acknowledged.
- Update `eraseSessionData` in `SqliteKvFabric` to correctly process and apply these pending updates from `session_kv_${realmName}` when a session terminates.

## Capabilities

### New Capabilities
- `session-persistent-kv`: Mechanism to register KV updates that should only be applied (or cleared) when the session that created them disconnects.
- `conditional-kv-updates`: Support for `when` and `watch` attributes in publish messages to provide synchronization primitives (mutex/locks).

### Modified Capabilities
- (None)

## Scope

- **In-Scope**: Single DB mode (SQLite) persistent storage for on-disconnect updates.
- **Out-of-Scope**: `NetEngine`, distributed mode synchronization, and cluster-wide session management.

## Impact

- **Storage**: SQLite schema change (table rename and column updates).
- **Internal API**: `SqliteKvFabric` methods will be updated to handle the new table.
- **Consistency**: Ensures `will` attributes in publishes are honored even if the router is in Single DB mode.
