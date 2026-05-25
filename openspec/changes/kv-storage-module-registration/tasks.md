## 1. Database Schema

- [ ] 1.1 Add `kv_storages` table creation logic to `lib/sqlite/history.ts` or a new metadata utility.
- [ ] 1.2 Ensure the table is created during system initialization.

## 2. Storage Registry Core

- [ ] 2.1 Define `StorageStatus` enum and `StorageRecord` interface in `lib/types.ts`.
- [ ] 2.2 Implement `StorageRegistry` class to handle DB operations (register, update status, update position).

## 3. Integration with SQLite KV

- [ ] 3.1 Integrate `StorageRegistry` into `lib/sqlite/sqlitekv.ts`.
- [ ] 3.2 Update status to `refreshing` when starting a sync.
- [ ] 3.3 Update status to `online` when sync is complete.
- [ ] 3.4 Persist `current_position` during message processing.

## 4. Verification

- [ ] 4.1 Create `test/56.kv_registry.ts` to test registration and lifecycle.
- [ ] 4.2 Verify that `current_position` correctly tracks the last processed message ID.
- [ ] 4.3 Test recovery scenario where storage resumes from `current_position`.
