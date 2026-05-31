## 1. Unified History Table Setup

- [x] 1.1 Formalize `update_history_${realmName}` table creation in `lib/sqlite/update_history.ts`.
- [x] 1.2 Ensure the table includes `msg_id`, `old_updated_by_msg_id`, `entity_type`, `entity_uri`, `action`, `msg_oldv`, and `msg_newv`.
- [x] 1.3 Set the primary key to `(entity_uri, msg_id)`.

## 2. KV History Refinement

- [x] 2.1 Refactor `setKeyValueLocked` in `lib/sqlite/sqlitekv.ts` to rename `stamp` to `updated_by_msg_id`.
- [x] 2.2 Ensure the previous `updated_by_msg_id` is fetched and passed as `old_updated_by_msg_id` to `saveUpdateHistory`.
- [x] 2.3 Verify that deleted keys record their last known value and last known message ID in the history.
- [x] 2.4 Update session-persistent (will) update logic to propagate the original causal ID through the history chain.

## 3. Storage Registry History Integration

- [x] 3.1 Update `StorageRegistry` to use the standardized history format.
- [x] 3.2 Ensure `entity_uri` is populated (using storage name) and `old_updated_by_msg_id` is handled (currently null for registry events).

## 4. Verification

- [x] 4.1 Add unit tests for `saveUpdateHistory` to verify correct SQL execution, entity/action fields, timestamps, and data serialization.
- [x] 4.2 Add integration tests for KV updates verifying history entries are created with correct `old_updated_by_msg_id` and `entity_uri`.
- [x] 4.3 Add integration tests for session-persistent updates verifying origin preservation in the history chain.
- [x] 4.4 Add integration tests for KV storage lifecycle events verifying history entries.
