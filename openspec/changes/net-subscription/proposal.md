## Why

In distributed mode (`NetEngine`), `getHistoryAfter` is a no-op stub — subscriptions with an `after` event ID receive no historical events. The `retained-state-event-sync` spec covers this for local engines; the distributed case has no implementation. Clients on entry nodes that reconnect or subscribe with an `after` position get nothing, making distributed event replay unusable.

## What Changes

- Storage node exposes `fox.storage.history.fetch` RPC on the sys realm: takes `{ realm, afterEventId }`, streams events in batches via progressive RPC (`opt.progress`), returns `{ done: true }`.
- Entry node announces its connection to each storage node and receives a shard-coverage announcement in return (`STORAGE_NODE_CONNECTED` on the sys realm).
- `NetSubStatusFactory` on the entry tracks, per shard tag, which storage node(s) serve it and their last committed event ID.
- `SharedSegmentBuffer` on the entry holds events fetched from storage nodes per realm; shared across all `ActorNetSub` instances for that realm.
- `ActorNetSub` is a new actor (or extended `ActorTrace`) that fetches from `SharedSegmentBuffer`, delivers events in `event_id ASC` order, and logs an error if out-of-order delivery is detected.
- `NetEngine.getHistoryAfter` is implemented to drive the fetch flow.
- `NetEngine.supportsRetainedEventSync` is set to `true` once at least one storage node is connected and has announced coverage for the realm.

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
- **`lib/masterfree/storage.ts`**: `EventStorageTask` registers `fox.storage.history.fetch` on its sys-realm API; adds shard-coverage announcement on connect.
- **`lib/sqlite/history.ts`**: `getEventHistory` used as-is; no changes needed.
- **`lib/masterfree/hyper.h.ts`**: New event constant `STORAGE_NODE_CONNECTED`; new types for RPC request/response and the announcement body.
- New file **`lib/masterfree/net_sub.ts`**: `NetSubStatusFactory`, `SharedSegmentBuffer`, `ActorNetSub`.
- No schema changes; no client-facing API changes.
