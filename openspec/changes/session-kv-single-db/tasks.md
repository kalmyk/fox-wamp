## 1. Schema Updates

- [ ] 1.1 Update `createKvTables` in `lib/sqlite/sqlitekv.ts` to rename `set_value` to `session_kv` and update fields (PRIMARY KEY is `key`).
- [ ] 1.2 Add logic to drop the legacy `set_value` table if it exists.

## 2. Implementation of Synchronization Primitives (when/watch)

- [ ] 2.1 Add an in-memory `resWhen: Map<string, Actor[]>` to `SqliteKvFabric`.
- [ ] 2.2 Implement `when` attribute check in `setKeyValue` using current DB value.
- [ ] 2.3 Implement `watch` attribute logic to park actors in `resWhen` map.
- [ ] 2.4 Implement watcher re-triggering logic after any successful key update.
- [ ] 2.5 Ensure parked actors are cleaned up from `resWhen` on session disconnect in `eraseSessionData`.

## 3. Implementation of Registration (will)

- [ ] 3.1 Modify `SqliteKvFabric.setKeyValue` to ALWAYS `DELETE FROM session_kv` for the current key to enforce "Last session wins" rule.
- [ ] 3.2 If `opt.will` is present, store it in `session_kv_${realmName}` along with the key, session ID, and message ID.

## 4. Implementation of Application on Disconnect

- [ ] 4.1 Update `SqliteKvFabric.eraseSessionData` to query `session_kv_${realmName}` for the terminating session ID.
- [ ] 4.2 For each found record, trigger `runInboundEvent` with the stored `will` value.
- [ ] 4.3 Delete the processed records from `session_kv_${realmName}` after application.

## 5. Implementation of Startup Recovery

- [ ] 5.1 Create `processStaleRecords` in `SqliteKvFabric` to query and process all existing `session_kv` records.
- [ ] 5.2 Update `DbEngine.launchEngine` to call `processStaleRecords` after table initialization.
- [ ] 5.3 Ensure `processStaleRecords` correctly triggers `runInboundEvent` and deletes the records.

## 6. Verification and Testing

- [ ] 6.1 Create a new test file `test/34.session_kv.ts` focused on Single DB mode.
- [ ] 6.2 Add test cases for registering "will" updates and verifying they are applied when the session is cleaned up.
- [ ] 6.3 Verify that `when` and `watch` correctly block/allow updates in Single DB mode.
- [ ] 6.4 Verify that multiple keys from the same session are all correctly updated.
- [ ] 6.5 Verify that updates are persistent across simulated router restarts (by re-opening the DB).
