## 1. Storage State Machine

- [ ] 1.1 Add storage state enum: Inactive, Refreshing, Online, deactivated, Failed.
- [ ] 1.2 Update `storage_desc_${realmName}` table to track state transitions with timestamps.
- [ ] 1.3 Add state validation logic: enforce valid transitions (Inactive → Refreshing, Online → deactivated, etc.).
- [ ] 1.4 Add transition logging: record all state changes to `update_history_${realmName}`.

## 2. Activate Command

- [ ] 2.1 Implement `StorageRegistry.activate(storageName, timeoutMs)` method.
- [ ] 2.2 Add validation: verify storage is Inactive and schema exists.
- [ ] 2.3 Implement backfill from committed history: query messages matching schema URL pattern.
- [ ] 2.4 Extract URL primary keys by position matching against `*` wildcards.
- [ ] 2.5 Merge URL values with body payload (URL takes precedence).
- [ ] 2.6 Validate merged payload against schema (types, required fields, primary_key non-null).
- [ ] 2.7 Upsert validated rows into generated table.
- [ ] 2.8 Track `current_position` during backfill for progress visibility.
- [ ] 2.9 Handle backfill failures: log errors, set status to Failed, store error in `last_error`.
- [ ] 2.10 Implement timeout: if activation exceeds timeoutMs, set status to Failed.
- [ ] 2.11 On completion: set status to Online.
- [ ] 2.12 Test activation with various message volumes and schema patterns.

## 3. Deactivate Command

- [ ] 3.1 Implement `StorageRegistry.deactivate(storageName)` method.
- [ ] 3.2 Add validation: verify storage is Online or Refreshing.
- [ ] 3.3 Set status to deactivated.
- [ ] 3.4 Stop accepting new writes to the generated table.
- [ ] 3.5 Clear `last_error` field.
- [ ] 3.6 Record deactivation in history.

## 4. Reactivate Command

- [ ] 4.1 Implement `StorageRegistry.reactivate(storageName, timeoutMs)` method.
- [ ] 4.2 Add validation: verify storage is deactivated.
- [ ] 4.3 Clear the generated table (full resync).
- [ ] 4.4 Reuse Activate flow (backfill from history, timeout handling, completion).
- [ ] 4.5 Test reactivation after deactivation with data freshness verification.

## 5. Remove Command

- [ ] 5.1 Implement `StorageRegistry.remove(storageName)` method.
- [ ] 5.2 Add validation: verify storage is deactivated.
- [ ] 5.3 Execute `DROP TABLE data_<realmName>_<hash>`.
- [ ] 5.4 Delete storage record from `storage_desc_<realmName}`.
- [ ] 5.5 Record removal in history.
- [ ] 5.6 Verify storage cannot be retrieved after removal.

## 6. Schema Replacement Flow

- [ ] 6.1 Document and test full replacement scenario: register new schema, activate new storage, deactivate old, remove old.
- [ ] 6.2 Verify no data loss during transition.
- [ ] 6.3 Verify old and new schemas coexist without collision.
- [ ] 6.4 Test error handling if activation of new schema fails before old is deactivated.

## 7. Error Handling and Timeouts

- [ ] 7.1 Add timeout configuration (default: 60s, configurable per command or deployment).
- [ ] 7.2 Implement timeout enforcement during backfill.
- [ ] 7.3 Set storage status to Failed on timeout.
- [ ] 7.4 Store descriptive error message in `last_error`.
- [ ] 7.5 Add retry logic: allow reactivation after failure.
- [ ] 7.6 Test timeout behavior with slow/blocked history queries.

## 8. Validation and Constraints

- [ ] 8.1 Verify schema exists before activation.
- [ ] 8.2 Verify generated table exists and can be written to.
- [ ] 8.3 Enforce primary_key non-null validation during backfill.
- [ ] 8.4 Test type validation during backfill (reject invalid types).
- [ ] 8.5 Test URL pattern matching during backfill (skip non-matching messages).

## 9. Testing

- [ ] 9.1 Unit tests for state machine transitions (valid and invalid).
- [ ] 9.2 Unit tests for activate command with various message counts.
- [ ] 9.3 Unit tests for backfill with schema pattern matching.
- [ ] 9.4 Unit tests for deactivate and reactivate commands.
- [ ] 9.5 Unit tests for remove command and table cleanup.
- [ ] 9.6 Integration tests for full replacement scenario (new schema, old schema, transition).
- [ ] 9.7 Integration tests for error scenarios (timeout, validation failure, network loss).
- [ ] 9.8 Concurrency tests: ensure no race conditions during activation.
- [ ] 9.9 Test that old and new tables coexist independently during replacement.
- [ ] 9.10 Performance tests: measure backfill speed for 10k, 100k, 1M messages.

## 10. Documentation and Examples

- [ ] 10.1 Add command examples to `foxctl` or API docs (activate, deactivate, reactivate, remove).
- [ ] 10.2 Document timeout configuration options.
- [ ] 10.3 Document error codes and troubleshooting steps.
- [ ] 10.4 Document schema replacement scenario with step-by-step instructions.
