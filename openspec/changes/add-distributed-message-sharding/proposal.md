## Why

The current message sharding mechanism uses a generic `tag` field for segment tracking, making it unclear how shards are allocated and distributed across nodes. To improve scalability and clarity in distributed message storage, we need to formalize the sharding strategy by renaming `tag` to `shardTag` and implementing explicit round-robin shard allocation across 2^20 (1048576) shards at the entry node level. This will establish a deterministic, load-balanced distribution pattern for messages across storage nodes.

## What Changes

- **Rename `tag` to `shardTag`** across all message protocol structures (`BODY_BEGIN_ADVANCE_SEGMENT`, `BODY_ADVANCE_SEGMENT_OVER`, `BODY_GENERATE_DRAFT`, `BODY_PICK_CHALLENGER`, `BODY_ELECT_SEGMENT`) in the HyperNet protocol definitions.
- **Implement round-robin shard allocation** at the entry node: Distribute incoming messages across 2^20 (1048576) shards using a monotonically incrementing round-robin counter.
- **Update netengine and synchronizer** to use the formalized `shardTag` field for shard-aware message routing and storage decisions.
- **Document shard assignment semantics** explaining how entry nodes assign shards and how storage nodes use `shardTag` for placement decisions.

## Capabilities

### New Capabilities
- `message-shard-allocation`: Formalized round-robin shard allocation strategy at entry nodes, distributing messages across 2^20 shards to enable scalable, deterministic message distribution for distributed storage.

### Modified Capabilities
- `distributed-mode`: Updated to leverage explicit `shardTag` field for message routing and shard-aware storage placement (renaming the generic `tag` field for clarity and semantic correctness).

## Impact

**Affected Code:**
- `lib/masterfree/hyper.h.ts`: Type definitions for protocol bodies.
- `lib/masterfree/entry.ts`: Entry node implementation—allocate shards via round-robin.
- `lib/masterfree/netengine.ts`: Current `tag` usage for segment sharding.
- `lib/masterfree/synchronizer.ts`: Current `tag` usage in protocol message handling.
- `lib/masterfree/storage.ts`: Current `tag` usage in data persistence.

**APIs/Interfaces:**
- Protocol message bodies will change `tag` to `shardTag` (BREAKING for any external tools that depend on these internals).

**Dependencies:**
- No new external dependencies required.

**Testing:**
- Need unit tests for round-robin shard allocation logic.
- Integration tests to verify shardTag is correctly propagated through the message lifecycle.
