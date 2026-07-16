## Why

In distributed mode (`NetEngine`), `getHistoryAfter` is a no-op stub — subscriptions with an `after` event ID receive no historical events. The `retained-state-event-sync` spec covers this for local engines; the distributed case has no implementation. Clients on entry nodes that reconnect or subscribe with an `after` position get nothing, making distributed event replay unusable.

## What Changes

- Storage node exposes `fox.storage.history.fetch.<shardTag>` as a progressive RPC on the sys realm, registered once per shard it owns: takes `{ realm, afterEventId }`, streams that shard's events in batches via progressive RPC (`opt.progress`), returns `{ done: true }`. Registering per shard (rather than one RPC per node covering a whole realm) means a shard replicated across multiple storage nodes is served by whichever registrant the router's existing shared-registration RPC dispatch picks — no entry-side node tracking or selection logic is needed for replication.
- Storage node announces its connection to the entry (`STORAGE_NODE_CONNECTED` on the sys realm, bridged via the existing `pipe()` idiom already used for other cross-node signals in `listenEntry`) — used only to gate `supportsRetainedEventSync`, not to track per-shard coverage.
- `NetSubStatusFactory` on the entry tracks only whether any storage node has ever connected (`hasStorageNodes()`).
- `SharedSegmentBuffer` on the entry holds events fetched from all shard RPC calls for a realm; shared across all `ActorNetSub` instances for that realm. Fetches all `TOTAL_SHARDS_COUNT` shard tags on every access (a fixed, known set — never zero, never open-ended), treating an unregistered shard (`ERROR_NO_SUCH_PROCEDURE`) as "no data for that shard" rather than a failure.
- `ActorNetSub` is a new actor (or extended `ActorTrace`) that fetches from `SharedSegmentBuffer`, delivers events in `event_id ASC` order, and logs an error if out-of-order delivery is detected.
- `NetEngine.getHistoryAfter` is implemented to drive the fetch flow.
- `NetEngine.supportsRetainedEventSync` is set to `true` once at least one storage node has ever connected.

## Capabilities

### New Capabilities

- `net-history-fetch`: Storage-side progressive RPC that streams committed events from `event_history_<realm>` to callers using `msg_id ASC` order. Cursor-based pagination via `afterEventId`.
- `net-subscription-status`: Entry-side tracking of connected storage nodes, their shard assignments, and last committed event ID per shard.
- `net-subscription-buffer`: Shared per-realm event buffer on entry nodes. Receives streamed events from all connected storage nodes, merges by `event_id ASC`, and serves waiting `ActorNetSub` instances.
- `actor-net-sub`: Subscriber actor that drives the fetch-and-deliver loop: requests buffer fill, waits for events past `afterEventId`, delivers in ASC order, gates live events until catch-up is complete.

### Modified Capabilities

- `retained-state-event-sync`: Distributed mode now supports `after`-based history replay via `NetEngine`. Requirements for distributed case now fully covered.

## Impact

- **`lib/masterfree/netengine.ts`**: `NetEngine.getHistoryAfter` implemented; `NetEngineMill` gains `NetSubStatusFactory` and `SharedSegmentBuffer`; `supportsRetainedEventSync` toggled at runtime.
- **`lib/masterfree/storage.ts`**: `EventStorageTask` registers `fox.storage.history.fetch.<shardTag>` per owned shard on its sys-realm API; bridges a minimal `STORAGE_NODE_CONNECTED` announcement to the connecting entry via `pipe()`.
- **`lib/sqlite/history.ts`**: `getEventHistory` used as-is; no changes needed (shard filtering happens in the RPC handler using the already-returned `shard` field per row).
- **`lib/masterfree/hyper.h.ts`**: New event constant `STORAGE_NODE_CONNECTED` (payload: `{ nodeId }`); new types for the per-shard RPC request/progress payload.
- New file **`lib/masterfree/net_sub.ts`**: `NetSubStatusFactory` (connection-existence tracking only), `SharedSegmentBuffer` (fixed-shard-range fetch), `ActorNetSub`.
- No schema changes; no client-facing API changes.
