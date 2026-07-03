## Context

The current Fox-WAMP distributed mode (Masterfree) uses a generic `tag` field in protocol messages to track segment sharding information during the multi-stage message lifecycle. The `tag` is set in the entry node via `netengine.ts` as a simple shard identifier (`"s" + this.curSegment.getShard()`), but the semantics and allocation strategy are implicit rather than formalized.

Critically, `KEEP_ADVANCE_HISTORY` is published to a single broadcast topic that **all storage nodes subscribe to**, regardless of which shard they own. There is even a commented-out line in `getDestinationTopics()`:
```
return [Event.KEEP_ADVANCE_HISTORY /* + '.' + (this.shard % 16) */]
```
which shows the intended direction. This change completes it.

The system needs a clearer, more explicit shard allocation and routing mechanism to:
1. Eliminate unnecessary broadcast of `KEEP_ADVANCE_HISTORY` to every storage node
2. Enable deterministic load balancing — each storage node processes only its own shards
3. Make the shard assignment strategy transparent and testable

## Goals / Non-Goals

**Goals:**
- Rename the generic `tag` field to `shardTag` across all HyperNet protocol message types for semantic clarity.
- Implement round-robin shard allocation at the entry node, cycling through 2^3 (8) shards for each new segment.
- Route `KEEP_ADVANCE_HISTORY` to a dedicated per-shard sys-realm topic (`KEEP_ADVANCE_HISTORY.<shardTag>`) instead of broadcasting.
- Each storage node subscribes only to the shard topics it owns.
- Ensure backward compatibility at the node communication layer (internal protocol only — no external API change).

**Non-Goals:**
- Implementing dynamic shard rebalancing or migration logic.
- Changing the consensus or election protocol in the sync cluster.
- Storing `msg_shard` in the database (the topic routing makes this redundant for basic sharding; can be added later for diagnostics).

## Decisions

### Decision 1: 2^3 Shard Space
**Rationale:** 8 shards provide fine-grained load distribution across typical cluster sizes. Powers of 2 make modulo arithmetic efficient.
**Alternatives:**
- 2^10 (1024) or higher: Finer granularity, but adds overhead with no benefit at current cluster sizes.
- Physical shards only: Ties the entry node counter directly to the cluster topology, forcing counter changes on rebalancing.

### Decision 2: Round-Robin at Entry Node
**Rationale:** Allocating shards at the entry point via a monotonic counter ensures deterministic, predictable distribution without requiring inter-node coordination. Each new segment gets `shardTag = shardCounter++ % 8`.
**Alternatives:**
- Hash-based allocation (by topic or client): Topic-dependent sharding leads to hot shards; client-based sharding ties shards to session lifetime.
- Per-segment random allocation: Non-deterministic, complicates testing and debugging.

### Decision 3: Field Rename from `tag` to `shardTag`
**Rationale:** The current name `tag` is ambiguous. `shardTag` explicitly describes its purpose. The change is confined to the internal protocol with no external API exposure.
**Alternatives:**
- Keep `tag` and document it: Leaves ambiguity and future confusion.

### Decision 4: Shard Allocation Counter Startup
**Rationale:** Store the round-robin counter as instance state in `netengine.ts`. On startup, initialise to a random value in `[0, 7]` and continue from there. No recovery from storage needed.
**Alternatives:**
- Persist counter: Extra I/O overhead.
- Coordinate across entry nodes: Adds latency and consensus overhead; not needed for load balancing.

### Decision 5: Topic-Based Routing for KEEP_ADVANCE_HISTORY
**Rationale:** `KEEP_ADVANCE_HISTORY` is published to a shard-specific sub-topic in the sys realm instead of broadcasting. The topic format is `KEEP_ADVANCE_HISTORY.<shardTag>` — the shardTag is used directly with no modulo division. The helper `Event.keepAdvanceHistoryTopic(shardTag)` lives on the `Event` namespace so shard topics stay coupled to the event they carry.

`getDestinationTopics()` on the segment object always returns `KEEP_ADVANCE_HISTORY.<shardTag>`. Each storage node subscribes to `KEEP_ADVANCE_HISTORY.<shardTag>` for each value in its `shards` array.

**Alternatives:**
- Separate prefix (`keepHistory.<shardTag>`): Disconnects the topic name from the event constant, requiring callers to know both.
- Divide shardTag by a configurable `shardCount`: Adds indirection — the `shards` array in config already maps node to owned values directly, making a separate `shardCount` redundant.
- Filter on receive (all nodes receive all, discard unwanted): What exists today. Eliminates the benefit of sharding at the network layer.

### Decision 6: Event Node Configuration in config.json
**Rationale:** The single cluster config file (`supervisor/config.json`) holds an `eventNodes` section mapping node IDs to their connection details and owned shardTag values. No top-level `shardCount` — the shard space size is fixed at `TOTAL_SHARDS_COUNT = 8` in code.

```json
"eventNodes": {
    "NDB1": { "host": "127.0.0.1", "port": "1755", "shards": [0, 1] },
    "NDB2": { "host": "127.0.0.1", "port": "1756", "shards": [2, 3] }
}
```

A storage node is launched with `NODE_ID=NDB1`. On startup it reads its entry from `eventNodes`, discovers its owned shardTags, and subscribes to `KEEP_ADVANCE_HISTORY.<shardTag>` for each. Event history is stored in `event_history_<realmName>` tables (unchanged from the broadcast case).

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| **Counter wraparound after 2^32 messages** | Modulo 8 wraps naturally; no action needed. |
| **Counter lost on entry node restart** | Start from a random value. Recovery not required; round-robin distribution remains statistically even. |
| **Protocol break for tooling inspecting raw messages** | Internal only. Update tooling alongside the code change. |
| **Bursty clients concentrate on adjacent shards** | Round-robin is per-entry-node; with multiple entry nodes the shard allocation interleaves. Monitor post-launch. |

## Migration Plan

1. **Phase 1: Protocol rename** (low risk)
   - Rename `tag` → `shardTag` in `hyper.h.ts` and all usages in netengine, synchronizer, storage.

2. **Phase 2: Round-robin allocation and topic routing** (low risk)
   - Add `shardCounter` to entry node; implement `getDestinationTopics()` returning `KEEP_ADVANCE_HISTORY.<shardTag>`.
   - Update storage node to read `NODE_ID` env var at startup, subscribe to `KEEP_ADVANCE_HISTORY.<shardTag>` for each owned shard instead of the broadcast topic.

3. **Phase 3: Testing & Validation** (medium risk)
   - Unit tests for allocation, wraparound, and topic name generation.
   - Integration tests confirming delivery only to the owning storage node.

4. **Phase 4: Deployment**
   - Rolling update with agreed N. No schema changes. No downtime expected.

## Open Questions

1. Should `shardTag` be a number or a string?
   Decision: `number` — no string conversion, no `"s"` prefix. Simpler, no `parseInt` needed in routing.

2. Can one storage node own multiple shard values?
   Decision: Yes — a node configured with `shards: [2, 3]` subscribes to both `KEEP_ADVANCE_HISTORY.2` and `KEEP_ADVANCE_HISTORY.3`. Useful for small clusters where fewer NDB nodes than shards are running.
