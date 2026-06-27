## 1. Protocol and Message Type Updates

- [x] 1.1 Rename `tag` field to `shardTag` in BODY_BEGIN_ADVANCE_SEGMENT type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.2 Rename `tag` field to `shardTag` in BODY_ADVANCE_SEGMENT_OVER type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.3 Rename `tag` field to `shardTag` in BODY_GENERATE_DRAFT type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.4 Rename `tag` field to `shardTag` in BODY_PICK_CHALLENGER type definition in `lib/masterfree/hyper.h.ts`
- [x] 1.5 Rename `tag` field to `shardTag` in BODY_ELECT_SEGMENT type definition in `lib/masterfree/hyper.h.ts`

## 2. Config File: eventNodes Schema

- [x] 2.1 Add `eventNodes` section to `supervisor/config.json` with named schemas, each containing `shardCount` and per-node `shards` arrays (see design doc for structure)
- [x] 2.2 Add `getEventSchema(schemaName)` and `getEventSchemaNames()` methods to `Config` class
- [x] 2.3 Add `findSchemasForNode(nodeId)` method returning all `{ schemaName, shardCount, shards }` entries where nodeId appears
- [ ] 2.4 Validate on startup: at least one schema found for nodeId, all shard values are integers in `[0, shardCount-1]`

## 3. Entry Node Shard Allocation

- [ ] 3.1 Add `shardCounter` instance variable to the entry node in `lib/masterfree/netengine.ts`
- [ ] 3.2 Initialise `shardCounter` to a random integer in `[0, 1048575]` on construction
- [ ] 3.3 For each new segment, assign `shardTag = shardCounter++ % 1048576` as a plain integer
- [ ] 3.4 Update BEGIN_ADVANCE_SEGMENT generation to include the assigned `shardTag`

## 4. Topic-Based Routing of KEEP_ADVANCE_HISTORY

- [ ] 4.1 Implement `getDestinationTopics()` on the segment object to return `['keepHistory_' + schemaName + '.' + (shardTag % shardCount)]` instead of the broadcast `Event.KEEP_ADVANCE_HISTORY`
- [ ] 4.2 Pass `schemaName` and `shardCount` (from config) into the entry node so `getDestinationTopics()` has access to them
- [ ] 4.3 Update the entry node to publish `KEEP_ADVANCE_HISTORY` to the topic returned by `getDestinationTopics()` (replaces the commented-out sharding logic)
- [ ] 4.4 Verify that ADVANCE_SEGMENT_OVER and other non-history messages remain on their existing broadcast topics — only KEEP_ADVANCE_HISTORY is shard-routed

## 5. Storage Node Startup and Subscription

- [ ] 5.1 Accept `--node-id <id>` CLI argument in the storage node entrypoint
- [ ] 5.2 On startup, call `config.findSchemasForNode(nodeId)` to discover all schemas and owned shards
- [ ] 5.3 Subscribe to `keepHistory_<schemaName>.<bucket>` for each bucket across all discovered schemas instead of the broadcast `Event.KEEP_ADVANCE_HISTORY`
- [ ] 5.4 Remove the old broadcast `KEEP_ADVANCE_HISTORY` subscription
- [ ] 5.5 Log all discovered schemas, their shardCount, and owned buckets on startup

## 5a. Event History Table Naming

- [ ] 5a.1 Rename event history table from `event_history_<realmName>` to `event_history_<schemaName>_<realmName>` in the storage node
- [ ] 5a.2 Update `saveEventHistory` and all table-creation / query helpers to use the schema-qualified table name

## 6. Synchronizer Protocol Updates

- [ ] 6.1 Update GENERATE_DRAFT construction in `lib/masterfree/synchronizer.ts` to carry `shardTag` from the incoming segment
- [ ] 6.2 Update PICK_CHALLENGER construction to propagate `shardTag` unchanged
- [ ] 6.3 Update ELECT_SEGMENT construction to propagate `shardTag` unchanged

## 7. Cleanup: Remaining `tag` References

- [ ] 7.1 Grep for remaining `.tag` / `[tag]` field accesses in masterfree source files and rename to `shardTag`
- [ ] 7.2 Update ADVANCE_SEGMENT_OVER usages to use `shardTag`

## 8. Testing and Validation

- [ ] 8.1 Unit test: sequential shard allocation increments by 1 modulo 1048576
- [ ] 8.2 Unit test: counter wraps from 1048575 back to 0
- [ ] 8.3 Unit test: `getDestinationTopics()` returns correct topic for given shardTag, schemaName, shardCount (e.g. shardTag=42, schema="main", shardCount=16 → "keepHistory_main.10")
- [ ] 8.4 Unit test: `findSchemasForNode` returns correct schemas and shards; node subscribes to all matching `keepHistory_<schemaName>.*` topics
- [ ] 8.5 Integration test: `KEEP_ADVANCE_HISTORY` is delivered only to the storage node that owns the bucket — not to others
- [ ] 8.6 Integration test: `shardTag` propagates unchanged through GENERATE_DRAFT → PICK_CHALLENGER → ELECT_SEGMENT
- [ ] 8.7 Integration test: two-node storage cluster where each node owns half the shards receives the correct subset of messages
- [ ] 8.8 Run full test suite: `npm test`

## 9. Admin RPC: Event Shard List

- [ ] 9.1 Add `AdminEvent.EVENT_SHARD_LIST = 'fox.admin.event.shard.list'` to the `AdminEvent` namespace in `lib/masterfree/hyper.h.ts`
- [ ] 9.2 Register `fox.admin.event.shard.list` handler in `AdminApiServer`: reads the cluster config, iterates all event schemas, and returns each schema's `shardCount` and per-shard entry: `{ schemaName, shardCount, shards: [{ bucket, nodeId, host, port }] }`
- [ ] 9.3 Integration test: RPC returns correct schema and shard layout matching the config

## 10. Logging

- [ ] 10.1 Log `shardTag` assignment in the entry node when a new segment is created
- [ ] 10.2 Log the shard topic subscription list on storage node startup
- [ ] 10.3 Log `shardCount` on both entry and storage node startup

## 11. Build and Final Checks

- [ ] 11.1 Run `npm run compile` — no TypeScript errors
- [ ] 11.2 Grep for any remaining `.tag` (not `.shardTag`) in masterfree source files
- [ ] 11.3 Verify no external test fixtures reference the old `tag` field name
