## Why

The current message sharding mechanism uses a generic `tag` field for segment tracking, and `KEEP_ADVANCE_HISTORY` is broadcast to **all storage nodes** without any routing — every NDB receives every segment regardless of which shard it owns. To fix this, we formalize a topic-based shard routing scheme: `KEEP_ADVANCE_HISTORY` is published to a dedicated per-shard topic in the sys realm, and each storage node subscribes only to the topics for the shards it is responsible for. This eliminates unnecessary broadcast traffic and makes horizontal scaling of the storage tier explicit and controllable.

## What Changes

- **Rename `tag` to `shardTag`** across all message protocol structures (`BODY_BEGIN_ADVANCE_SEGMENT`, `BODY_ADVANCE_SEGMENT_OVER`, `BODY_GENERATE_DRAFT`, `BODY_PICK_CHALLENGER`, `BODY_ELECT_SEGMENT`) in the HyperNet protocol definitions.
- **Implement round-robin shard allocation** at the entry node: distribute incoming messages across 2^20 (1048576) virtual shards using a monotonically incrementing counter, initialised to a random value on startup.
- **Route `KEEP_ADVANCE_HISTORY` to a dedicated shard topic** instead of broadcasting. The entry node publishes to `keepHistory_<schemaName>.<bucket>` where `schemaName` is the named event node schema from config and `bucket = shardTag % shardCount`. Implemented in `getDestinationTopics()` on the segment object.
- **Storage nodes subscribe to specific shard topics** based on their section in the config. A node launched as `--schema main --node-id NDB1` reads its `shards` array and subscribes to the matching `keepHistory_main.*` topics. Using the schema name as the topic namespace allows multiple schemas with different `shardCount` values to coexist during topology changes.
- **Update netengine and synchronizer** to use `shardTag` throughout message flow.

## Capabilities

### New Capabilities
- `message-shard-allocation`: Round-robin virtual shard allocation at entry nodes and topic-based routing of `KEEP_ADVANCE_HISTORY` to dedicated per-shard sys-realm topics (`keepHistory_<N>.<bucket>`).

### Modified Capabilities
- `distributed-mode`: Eliminates broadcast of `KEEP_ADVANCE_HISTORY`. Each storage node subscribes only to its assigned shard topics. The `tag` field is renamed to `shardTag` for semantic clarity.

## Impact

**Affected Code:**
- `lib/masterfree/hyper.h.ts`: `tag` → `shardTag` in all protocol body types.
- `lib/masterfree/netengine.ts`: `getDestinationTopics()` returns `keepHistory_<N>.<bucket>`; round-robin shard counter added.
- `lib/masterfree/synchronizer.ts`: `shardTag` propagation in GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT.
- `lib/masterfree/storage.ts`: Subscribe to `keepHistory_<schemaName>.<bucket>` for owned shards instead of the broadcast `KEEP_ADVANCE_HISTORY`.
- `supervisor/config.json`: New `eventNodes` section with named schemas, each containing `shardCount` and per-node `shards` arrays.
- `lib/masterfree/config.ts`: New `getEventSchema()` and `getEventNodeById()` methods.

**APIs/Interfaces:**
- Internal HyperNet protocol: `tag` → `shardTag` (breaking for any tooling that inspects raw protocol messages).
- New sys-realm topic namespace: `keepHistory_<schemaName>.<bucket>`.

**Dependencies:**
- No new external dependencies required.

**Testing:**
- Unit tests for round-robin shard allocation and wraparound.
- Unit tests for topic name generation (`keepHistory_<N>.<bucket>`).
- Integration tests verifying `KEEP_ADVANCE_HISTORY` is delivered only to the owning storage node and not others.
