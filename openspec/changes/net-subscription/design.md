# Design: net-subscription

## Context

`NetEngine` (the distributed engine used by entry nodes) has a stub `getHistoryAfter` that returns an empty result. `supportsRetainedEventSync` is `false`. This means any WAMP `SUBSCRIBE` with `options.after` on a distributed realm silently delivers no history.

The storage layer already has all the necessary pieces:
- `event_history_<realm>` table with `msg_id` ordering that is globally monotonic (segment IDs are committed with strictly increasing values by the synchronizer's `recentValue` guard; event IDs are `segmentId + keyId(offset)` which inherit that order)
- `getEventHistory(db, realm, { fromId, toId }, cb)` — cursor-based reader
- Progressive RPC support in `HyperClient` (`opt.progress` / `RESULT_EMIT`)

The missing pieces are the network path from entry to storage and the buffering / actor wiring on the entry side.

## Goals / Non-Goals

**Goals**
- Entry node can stream historical events from connected storage nodes via `fox.storage.history.fetch` RPC
- Multiple `ActorNetSub` instances for the same realm share one buffer (one fetch stream per realm per storage node)
- Events delivered to subscribers in `event_id ASC` order; violation logged as error
- Storage nodes announce their shard coverage when connecting to entry so entry knows which node to call for which shard
- `NetEngine.getHistoryAfter` drives the fetch; `supportsRetainedEventSync` enabled when a covering storage node is connected

**Non-Goals**
- Cross-shard merge ordering guarantees beyond best-effort (events from different shards at the same timestamp are unordered relative to each other — this is a deliberate design choice)
- Persistent cursor storage (cursor lives in memory; reconnect restarts from `afterEventId`)
- Snapshot subscription support (`supportsSnapshotSubscription` remains `false`)
- Authentication / authorisation on the history fetch RPC

## Decisions

### D1: Event ID ordering is sufficient — no segment registry traversal for fetch

`event_history_<realm>.msg_id` sorts globally in the same order as segment commit order because:
1. The synchronizer's `recentValue` guard ensures each new `segment_id` (maxChallenger) is strictly greater than all previous ones
2. Event IDs are `segment_id + keyId(offset)`, inheriting that order

**Therefore**: `getEventHistory(db, realm, { fromId: afterEventId })` already returns events in the correct global ASC order. No need to walk `segment_registry`.

Alternative considered: Walk `segment_registry` ordered by `segment_id ASC` and emit per-segment batches. Rejected: extra complexity with no ordering benefit, since `event_history` is already ordered.

### D2: Progressive RPC, one call per realm

`fox.storage.history.fetch` is a single progressive RPC registered per storage node on the sys realm. The caller provides `{ realm, afterEventId }`. The handler streams batches of events as `opt.progress` calls. Final result is `{ done: true }`.

**Batching**: storage groups events by segment boundary. Each progress call is one segment's events: `{ events: [...], lastEventId: string }`. This makes the cursor natural: the caller advances `afterEventId` to `lastEventId` on each batch.

Alternative considered: Single non-progressive call with limit/pagination. Rejected: forces multiple round-trips and buffers all events server-side before responding.

### D3: SharedSegmentBuffer per realm per entry node

All `ActorNetSub` instances for the same realm on the same entry node share one fetch stream and buffer. The first subscriber triggers the fetch; subsequent subscribers attach to the in-progress buffer.

```
NetEngineMill
  realmBuffers: Map<realmName, SharedSegmentBuffer>

SharedSegmentBuffer
  events: HistoryEvent[]          // all fetched events in order
  cursor: string | null           // last fetched eventId
  loading: boolean
  done: boolean
  waiters: Set<() => void>        // notify when new events arrive
```

The buffer is append-only and never evicts (in-memory for the session lifetime). Subscribers iterate forward from their `afterEventId` position.

### D4: Storage node announcement on connect

When `EventStorageTask.listenEntry(client, gateId)` is called, storage publishes `STORAGE_NODE_CONNECTED` on the sys realm:

```
{ nodeId: string, shards: number[], lastEventId: string | null }
```

`NetSubStatusFactory` on the entry absorbs this. `lastEventId` is the max `msg_id` across all realms on that node at connection time (from `scanMaxId`). It is informational — used to decide if the node has data for a realm.

### D5: Multi-node per shard — pick any, merge on event_id

A shard can exist on more than one history node (replication). `NetSubStatusFactory` tracks all nodes per shard:

```
NetSubStatusFactory
  shardNodes: Map<shardTag, NodeStatus[]>
    NodeStatus: { nodeId, storageClient, lastEventId }
```

For a realm fetch, the entry calls ALL connected storage nodes for that realm (because any node may have events for any realm, bounded by the shards it owns). Streams are merged by `event_id ASC` on the entry side. If a node has no events for that realm, it returns `{ done: true }` immediately.

For multi-node same-shard: prefer the node with the higher `lastEventId` (more up-to-date). Fall back to others on failure.

### D6: ActorNetSub gates live delivery until catch-up

`ActorNetSub` (realized as `ActorTrace` with a net-history driver) defers `actor.traceStarted = true` (and therefore live event delivery) until historical replay is complete. This is identical to how `DbEngine.getHistoryAfter` works today.

```
getHistoryAfter(after, uri, cbRow):
  buffer = getOrCreateBuffer(realm)
  buffer.ensureLoading(storageClients)
  await buffer.drainUntil(after, (event) => cbRow(event))
  // returns — realm.doTrace continues to set traceStarted = true
```

## Risks / Trade-offs

**[Risk] Cross-shard event ordering** — Events from shard 0 (nodeA) and shard 4 (nodeB) at the same timestamp are merged by `event_id ASC`. Since segment IDs are globally monotonic (the synchronizer enforces this), this ordering is correct. But if two segments were committed nearly simultaneously and the IDs ended up very close, the merge-sort on the entry needs to wait for both streams to confirm no earlier event is coming. Mitigation: merge with a small hold-back per stream (wait until both streams have produced an event past the merge point before emitting).

**[Risk] Storage node not yet connected when subscriber arrives** — `getHistoryAfter` is called before any storage node has announced. Mitigation: `NetEngine.supportsRetainedEventSync` returns `false` if no storage nodes are connected; the realm gates the subscription accordingly (same as current behavior).

**[Risk] Buffer grows unbounded** — The `SharedSegmentBuffer` never evicts. For long-lived entry nodes with many historical events, memory grows. Mitigation: out of scope for MVP; future work to add a high-water-mark eviction.

**[Risk] RPC registered on sys realm — name collision** — `fox.storage.history.fetch` is a flat name. Multiple storage nodes each register it on their own sys-realm API instance. Since each node has its own API, there is no collision within a single sys realm. In the in-process test setup (shared sysRealm), only one storage can register at a time — tests must isolate. Mitigation: in tests, each storage task uses its own router/sysRealm.

## Migration Plan

- No data migration required; `event_history_<realm>` schema unchanged
- `supportsRetainedEventSync` on `NetEngine` transitions from `false` → `true` at runtime when first storage node connects; no restart required
- Existing subscriptions without `after` are unaffected

## Open Questions

- Should `fox.storage.history.fetch` filter events by URI (topic pattern) server-side, or always stream full realm history and let the entry filter? Server-side filtering reduces traffic but complicates the RPC.
- What is the maximum batch size per progress call? Fixed at 100 events? Configurable?
