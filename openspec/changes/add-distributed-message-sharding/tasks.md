## 1. Protocol and Message Type Updates

- [x] 1.1 Rename `tag` field to `shardTag` in BODY_BEGIN_ADVANCE_SEGMENT type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.2 Rename `tag` field to `shardTag` in BODY_ADVANCE_SEGMENT_OVER type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.3 Rename `tag` field to `shardTag` in BODY_GENERATE_DRAFT type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.4 Rename `tag` field to `shardTag` in BODY_PICK_CHALLENGER type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.5 Rename `tag` field to `shardTag` in BODY_ELECT_SEGMENT type definition in `lib/masterfree/hyper.h.ts`

## 2. NDB Configuration for Shard Scheme

- [ ] 2.1 Add `divider` configuration parameter to NDB config structure (default: 1048576) in `lib/masterfree/ndb.ts` or appropriate config module
- [ ] 2.2 Document in code that `divider` must be consistent across all NDB nodes in a cluster
- [ ] 2.3 Implement validation to ensure divider is a positive integer and loaded correctly on startup
- [ ] 2.4 Add logging on NDB startup to display configured divider value for operational visibility

## 3. Entry Node Shard Allocation Implementation

- [ ] 3.1 Add `shardCounter` instance variable to track shard allocation counter in `lib/masterfree/netengine.ts`
- [ ] 3.2 Implement round-robin shard allocation logic: `shardTag = "s" + (shardCounter++ % 1048576)` in entry node message creation
- [ ] 3.3 Update BEGIN_ADVANCE_SEGMENT generation to assign `shardTag` using round-robin allocation
- [ ] 3.4 Update ADVANCE_SEGMENT_OVER generation to use the same `shardTag` from the segment
- [ ] 3.5 Initialize shard counter to a random value in the 2^20 shard space on entry-node startup

## 4. NetEngine and Segment Management Updates

- [ ] 4.1 Update all existing references to `tag` field in `lib/masterfree/netengine.ts` to use `shardTag`
- [ ] 4.2 Verify that segment objects properly track and propagate `shardTag` throughout message flow
- [ ] 4.3 Update segment creation and lifecycle to ensure `shardTag` is assigned early and immutable

## 5. Storage Node Updates with msg_shard Computation

- [ ] 5.1 Update `lib/masterfree/storage.ts` to handle `shardTag` field in incoming messages
- [ ] 5.2 Implement `computeMsgShard(shardTag, divider)` function that extracts numeric shard ID and computes `msg_shard = (shardTag_numeric % divider)`
- [ ] 5.3 Update KEEP_ADVANCE_HISTORY message processing to compute and store `msg_shard` in addition to shardTag metadata
- [ ] 5.4 Update any storage queries or placement logic to use both `shardTag` and computed `msg_shard` values

## 6. Database Schema Changes

- [ ] 6.1 Create database migration to add nullable `msg_shard` (INTEGER) column to `event_history_${realmName}` tables
- [ ] 6.2 Add composite index on (realm, msg_shard, timestamp) for efficient shard-range queries
- [ ] 6.3 Write migration script to backfill `msg_shard` values for existing events: `msg_shard = (shardTag_numeric % 1048576) % divider` (or NULL if shardTag unknown)
- [ ] 6.4 Implement schema migration execution as part of NDB startup or separate migration tool
- [ ] 6.5 Test schema migration on local SQLite test databases

## 7. Synchronizer Protocol Updates

- [ ] 7.1 Update GENERATE_DRAFT message construction in `lib/masterfree/synchronizer.ts` to use `shardTag` field
- [ ] 7.2 Update PICK_CHALLENGER message construction to propagate `shardTag` unchanged
- [ ] 7.3 Update ELECT_SEGMENT message construction to propagate `shardTag` unchanged
- [ ] 7.4 Verify that all sync cluster operations preserve `shardTag` immutability

## 8. Testing and Validation

- [ ] 8.1 Write unit tests for round-robin shard allocation (allocation sequence, wraparound at 1048576)
- [ ] 8.2 Write unit tests for random shard counter initialization on node restart
- [ ] 8.3 Write unit tests for `computeMsgShard()` function with various divider values (4, 512, 1048576)
- [ ] 8.4 Write integration tests verifying `shardTag` is correctly assigned and propagated through message lifecycle
- [ ] 8.5 Write integration tests verifying `msg_shard` is correctly computed and stored in event_history
- [ ] 8.6 Write integration tests for multi-segment scenarios to verify deterministic allocation
- [ ] 8.7 Write tests for schema migration (backfill logic on legacy databases)
- [ ] 8.8 Write tests to verify backward compatibility with legacy events (NULL msg_shard)
- [ ] 8.9 Run full test suite: `npm test`

## 9. Documentation and Logging

- [ ] 9.1 Update code comments in `netengine.ts` to explain `shardTag` allocation strategy (round-robin across 1048576 shards)
- [ ] 9.2 Update code comments in `storage.ts` to document `msg_shard` computation and divider usage
- [ ] 9.3 Update code comments in `synchronizer.ts` to document `shardTag` immutability requirement
- [ ] 9.4 Add logging statements to trace `shardTag` assignment and propagation for debugging
- [ ] 9.5 Add logging statements to show `msg_shard` computation and divider value in storage operations
- [ ] 9.6 Update internal developer docs (if applicable) to explain shard allocation semantics and divider configuration
- [ ] 9.7 Add comments to database schema or migration scripts explaining `msg_shard` column purpose

## 10. Code Review and Final Checks

- [ ] 10.1 Verify all `tag` references have been renamed to `shardTag` (grep for remaining `tag` field accesses)
- [ ] 10.2 Verify divider is used consistently across all NDB nodes in tests
- [ ] 10.3 Run linting: `npm run lint`
- [ ] 10.4 Run full build: `npm run compile`
- [ ] 10.5 Verify no breaking changes to public APIs or external interfaces
- [ ] 10.6 Test schema migration on sample databases with existing data
- [ ] 10.7 Create summary of changes for release notes (protocol field rename, shard allocation formalization, database schema updates, divider configuration)
