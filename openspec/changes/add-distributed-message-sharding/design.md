## Context

The current Fox-WAMP distributed mode (Masterfree) uses a generic `tag` field in protocol messages to track segment sharding information during the multi-stage message lifecycle. The `tag` is set in the entry node via `netengine.ts` as a simple shard identifier (`"s" + this.curSegment.getShard()`), but the semantics and allocation strategy are implicit rather than formalized.

The system needs a clearer, more explicit shard allocation mechanism to:
1. Enable deterministic load balancing across storage nodes
2. Make the shard assignment strategy transparent and testable
3. Scale message distribution across a defined shard space (2^20 = 1048576 shards)

Current bottleneck: Message shard allocation is buried in segment logic without explicit round-robin distribution at the entry point.

## Goals / Non-Goals

**Goals:**
- Rename the generic `tag` field to `shardTag` across all HyperNet protocol message types for semantic clarity.
- Implement round-robin shard allocation at the entry node, cycling through 2^20 (1048576) shards for each new message.
- Document and formalize how `shardTag` is used for routing and storage placement decisions in the distributed system.
- Ensure backward compatibility at the node communication layer (internal protocol only—no external API change).

**Non-Goals:**
- Implementing dynamic shard rebalancing or migration logic.
- Adding heterogeneous shard sizing or advanced topology configuration beyond the shard scheme divider.
- Changing the consensus or election protocol in the sync cluster.

## Decisions

### Decision 1: 2^20 Shard Space
**Rationale:** 1048576 shards provide fine-grained load distribution for typical clusters while keeping state management and round-robin tracking lightweight. Powers of 2 align with bit-level operations and make modulo arithmetic efficient.
**Alternatives:** 
- 2^10 (1024): Coarser distribution, simpler but less scalability.
- 2^16 (65536): Finer distribution, but overkill for most deployments and adds memory overhead.

### Decision 2: Round-Robin at Entry Node
**Rationale:** Allocating shards at the entry point (via a monotonic counter incremented per message) ensures deterministic, predictable distribution without requiring inter-node coordination. Simple and fast.
**Alternatives:**
- Hash-based allocation (hash topic or client ID): Topic-dependent sharding can lead to hot shards; client-based sharding ties shards to session lifetime.
- Per-segment random allocation: Adds non-determinism, complicating testing and debugging.

### Decision 3: Field Rename from `tag` to `shardTag`
**Rationale:** The current name `tag` is ambiguous—it could mean session tag, segment tag, or trace tag. `shardTag` explicitly describes its purpose in routing messages to storage shards. Breaking change mitigated by this being an internal protocol (no external API exposure).
**Alternatives:**
- Keep `tag` and document it: Leaves ambiguity and future confusion.
- Use numeric shard ID directly: Would require schema changes and complicates trace/audit logs where the string tag is useful.

### Decision 4: Shard Allocation Counter Startup
**Rationale:** Store the round-robin counter as instance state in the entry node's `netengine.ts`. On entry-node startup, initialize the counter to a random value in the 2^20 shard space and continue round-robin allocation from there. There is no requirement to recover the last used shard from storage.
**Alternatives:**
- Persist counter to storage immediately: Extra I/O overhead per message.
- Coordinate counter across entry nodes via sync cluster: Adds latency and consensus overhead.
- Recover the highest observed shard from storage: Unnecessary for load distribution and couples shard allocation to the entry initialization handshake.

### Decision 5: NDB Shard Scheme Configuration (Divider-Based Mapping)
**Rationale:** Each NDB storage node maintains a configurable shard scheme via a `divider` parameter. The `msg_shard` value stored in the `event_history_${realmName}` table is computed as `msg_shard = shardTag % divider`. This allows:
- Multiple NDB nodes to be responsible for different ranges of shards
- Horizontal scaling by adjusting divider values across nodes
- Fine-grained placement control without changing the entry node's round-robin allocation
- Example: If divider=512, then 1048576 shards map to 512 physical shards; if divider=1048576, each virtual shard has its own storage slot

**Alternatives:**
- Fixed hash-based placement: Less flexible, requires rebalancing if topology changes.
- Direct shard ID usage: No division/bucketing, loses granularity in large deployments.

### Decision 6: Storage Table Schema Extension
**Rationale:** Add a `msg_shard` column to the `event_history_${realmName}` table(s) to store the computed shard value. This enables:
- Efficient queries by shard for diagnostics and recovery
- Shard-aware data migration or rebalancing
- Monitoring and telemetry on shard distribution within a realm
The `msg_shard` value is deterministic: `msg_shard = parseInt(shardTag.substring(1)) % divider`

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Counter wraparound after 2^32 messages per entry node** | At 1M msgs/sec, takes ~4000 seconds (1.1 hours) to wrap. Use modulo 1048576 to cycle through shards deterministically. Track absolute message count separately for debugging. |
| **Shard allocation counter lost on entry node restart** | Start from a random shard in the 2^20 shard space, then continue round-robin allocation. Recovery of the last used shard is not required. |
| **Client tools that parse internal protocol messages break** | No external-facing API changes, but internal tooling (debugging, monitoring) needs updates to recognize `shardTag` instead of `tag`. Document in migration notes. |
| **Uneven shard distribution if messages are bursty per client** | Round-robin is deterministic but doesn't account for per-client locality. If all messages from one client arrive in a burst on one entry node, they may concentrate on adjacent shards. Add monitoring to detect hot shards post-launch. |
| **Divider mismatch across NDB nodes** | If NDB nodes are configured with different divider values, the same shardTag will map to different msg_shard slots on different nodes, causing consistency issues. Solution: Divider must be synchronized and deployed uniformly across all NDB nodes in a cluster. Document in deployment guides. |
| **Database migration for existing deployments** | Existing `event_history_${realmName}` tables won't have `msg_shard` column. Add migration task to backfill `msg_shard = shardTag % divider` for existing events. Support both null (legacy) and computed values during transition. |
| **Query performance with new msg_shard column** | Adding `msg_shard` column and indexing it may impact write performance. Mitigation: Add composite index on (realm, msg_shard, timestamp) for efficient shard-range queries. Profile performance during integration testing. |

## Migration Plan

1. **Phase 1: Update Protocol Definitions & NDB Configuration** (low risk)
   - Rename `tag` → `shardTag` in `hyper.h.ts` type definitions.
   - Update all usages in netengine, synchronizer, and storage modules to refer to the new field name.
   - Add `divider` configuration parameter to NDB config (default: 1048576 for 1:1 mapping with entry node shards).
   - Document that divider must be consistent across all NDB nodes.

2. **Phase 2: Implement Round-Robin Allocation & Storage Computation** (low risk)
   - Add a `shardCounter` instance variable to the entry node's netengine.
   - Implement allocation logic: `shardTag = "s" + (shardCounter++ % 1048576)`.
   - Initialize the counter randomly on entry-node startup.
   - In storage.ts, compute `msg_shard = parseInt(shardTag.substring(1)) % divider` when storing events.
   - Add `msg_shard` column to `event_history_${realmName}` table schema.

3. **Phase 3: Database Migration** (medium risk)
   - Create database migration scripts for existing deployments to add `msg_shard` column.
   - Backfill existing events only when a legacy `shardTag` is available; otherwise leave `msg_shard = NULL`.
   - Support both null legacy values and computed values during transition period.
   - Add index on (realm, msg_shard) for efficient shard-range queries.

4. **Phase 4: Testing & Validation** (medium risk)
   - Unit tests for shard allocation and wraparound logic.
   - Unit tests for msg_shard computation: verify `msg_shard = (shardTag % 1048576) % divider` across various divider values.
   - Integration tests confirming `shardTag` is correctly propagated and `msg_shard` is correctly computed.
   - Load tests to verify even distribution across computed msg_shards.
   - Test database migration for existing deployments.

5. **Phase 5: Deployment**
   - Deploy database migration to all NDB nodes.
   - Deploy code changes to entry and storage nodes (rolling update).
   - Verify divider configuration is consistent across cluster.
   - No downtime expected; nodes gracefully handle messages with and without computed msg_shard during transition.
   - Monitor logs for shard distribution anomalies and query performance.

## Open Questions

1. Should the `shardTag` format remain string-based (`"s" + number`) or switch to numeric? String format is backward compatible with logging but slightly less efficient. Decision: Keep string format for now to maintain consistency with existing trace logs.

2. How will multi-entry-node deployments coordinate counter initialization after network partitions? Decision: They do not coordinate shard counters. Each entry node starts from a random shard and then advances round-robin within the 2^20 shard space.

3. What should be the default `divider` value for NDB nodes? Decision: Default to 1048576 (1:1 mapping with entry node shards), allowing operators to override based on deployment topology.

4. Should we index the `msg_shard` column in `event_history_${realmName}` tables? Decision: Yes—add composite index on (realm, msg_shard, timestamp) for efficient shard-range queries and diagnostics.

5. How long should we support null `msg_shard` values during the transition period? Decision: Support for one major version; then require backfill as mandatory before upgrade.
