## 1. Unified History Table Setup

- [ ] 1.1 Formalize `update_history_${realmName}` table creation in `lib/sqlite/sqlitekv.ts`.
- [ ] 1.2 Ensure the table includes `msg_id` (PK), `msg_origin`, `entity_type`, `entity_id`, `action`, `msg_oldv`, `msg_newv`, and `created_at`.
- [ ] 1.3 Move `saveUpdateHistory` helper to a more shared location if appropriate, or ensure it is accessible to both KV and Schema modules.

## 2. KV History Refinement

- [ ] 2.1 Refactor `setKeyValueLocked` in `lib/sqlite/sqlitekv.ts` to consistently use the standardized history format.
- [ ] 2.2 Ensure the originating message ID is correctly passed to `saveUpdateHistory`.
- [ ] 2.3 Verify that deleted keys record their last known value in the history.
- [ ] 2.4 Update session-persistent (will) update logic to propagate the original `msg_id` to the history table upon application.

## 3. Schema History Integration

- [ ] 3.1 Add history recording to the schema registration path in `lib/sqlite/schema_repository.ts`.
- [ ] 3.2 Add history recording to schema activation and deactivation paths.
- [ ] 3.3 Ensure schema identifiers are used consistently as `entity_id` with `entity_type = 'schema'`.
- [ ] 3.4 Add history recording to KV storage projection lifecycle changes with `entity_type = 'kv_storage'`.

## 4. Verification

- [ ] 4.1 Add unit tests for `saveUpdateHistory` to verify correct SQL execution, entity/action fields, timestamps, and data serialization.
- [ ] 4.2 Add integration tests for KV updates verifying history entries are created with correct origin IDs and `entity_type = 'kv'`.
- [ ] 4.3 Add integration tests for session-persistent updates verifying origin ID propagation.
- [ ] 4.4 Add integration tests for schema lifecycle events verifying history entries.
- [ ] 4.5 Add integration tests for KV storage lifecycle events verifying history entries.
