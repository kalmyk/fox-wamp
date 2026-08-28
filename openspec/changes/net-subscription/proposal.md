## Why

In distributed mode (`NetEngine`), `getHistoryAfter` is a no-op stub — subscriptions with an `after` event ID receive no historical events. The `retained-state-event-sync` spec covers this for local engines; the distributed case has no implementation. Clients on entry nodes that reconnect or subscribe with an `after` position get nothing, making distributed event replay unusable.

**Revision (found during real-cluster validation with `democli/cluster-*.js`):** a plain `SUBSCRIBE` with no `after` was assumed to already work on distributed realms, since `BaseRealm.doTrace` marks it ready for live delivery the same way it does for local engines. It doesn't: `NetEngine.doPush` never calls `disperseToSubs`, so **no** subscription on a distributed realm — with or without `after` — ever received a live event; only this change's `after`-based catch-up (already implemented) works, and only up to the moment the fetch was issued. This proposal now also covers live-tail delivery: broadcasting each newly-committed event to every connected entry so both plain and `after`-based subscribers receive events published after they started listening.

## What Changes

- Storage node exposes `fox.storage.history.fetch.<shardTag>` as a progressive RPC on the sys realm, registered once per shard it owns: takes `{ realm, afterEventId }`, streams that shard's events in batches via progressive RPC (`opt.progress`), returns `{ done: true }`. Registering per shard (rather than one RPC per node covering a whole realm) means a shard replicated across multiple storage nodes is served by whichever registrant the router's existing shared-registration RPC dispatch picks — no entry-side node tracking or selection logic is needed for replication.
- Storage node announces its connection to the entry (`STORAGE_NODE_CONNECTED` on the sys realm, bridged via the existing `pipe()` idiom already used for other cross-node signals in `listenEntry`) — used only to gate `supportsRetainedEventSync`, not to track per-shard coverage.
- `NetSubStatusFactory` on the entry tracks only whether any storage node has ever connected (`hasStorageNodes()`).
- `SharedSegmentBuffer` on the entry holds events fetched from all shard RPC calls for a realm; shared across all `ActorNetSub` instances for that realm. Fetches all `TOTAL_SHARDS_COUNT` shard tags on every access (a fixed, known set — never zero, never open-ended), treating an unregistered shard (`ERROR_NO_SUCH_PROCEDURE`) as "no data for that shard" rather than a failure.
- `ActorNetSub` is a new actor (or extended `ActorTrace`) that fetches from `SharedSegmentBuffer`, delivers events in `event_id ASC` order, and logs an error if out-of-order delivery is detected.
- `NetEngine.getHistoryAfter` is implemented to drive the fetch flow.
- `NetEngine.supportsRetainedEventSync` is set to `true` once at least one storage node has ever connected.
- `SEGMENT_COMMITTED` — until now a local `EventEmitter` event on `dbFactory`, consumed in-process only by `ProjectionListener` — is promoted to a proper `hyper.h.ts` `Event`, piped storage → every connected entry the same way every other segment event already is. Storage broadcasts the same just-committed `events` batch it already emits locally, right after `commit_segment` durably persists a segment. This replaces the dead `'dispatchEvent'` string topic that `NetEngineMill` already subscribed to but nothing ever published, and avoids introducing a second, redundant broadcast for the same commit.
- Entry node de-duplicates incoming `Event.SEGMENT_COMMITTED` records (bounded window, keyed by `eventId`) before calling `disperseToSubs`, since a shard replicated across N storage nodes each broadcasts independently.

## Capabilities

### New Capabilities

- `net-history-fetch`: Storage-side progressive RPC that streams committed events from `event_history_<realm>` to callers using `msg_id ASC` order. Cursor-based pagination via `afterEventId`.
- `net-subscription-status`: Entry-side tracking of connected storage nodes, their shard assignments, and last committed event ID per shard.
- `net-subscription-buffer`: Shared per-realm event buffer on entry nodes. Receives streamed events from all connected storage nodes, merges by `event_id ASC`, and serves waiting `ActorNetSub` instances.
- `actor-net-sub`: Subscriber actor that drives the fetch-and-deliver loop: requests buffer fill, waits for events past `afterEventId`, delivers in ASC order, gates live events until catch-up is complete.
- `net-live-dispatch`: Storage-to-entry live broadcast of newly-committed events, piped as `Event.SEGMENT_COMMITTED` (the same event storage already emits in-process for its projections), fanned out to every connected entry and de-duplicated on receipt, feeding the existing (previously unfed) `disperseToSubs` call in `NetEngineMill`.

### Modified Capabilities

- `retained-state-event-sync`: Distributed mode now supports `after`-based history replay via `NetEngine`. Requirements for distributed case now fully covered.

## Impact

- **`lib/masterfree/netengine.ts`**: `NetEngine.getHistoryAfter` implemented; `NetEngineMill` gains `NetSubStatusFactory` and `SharedSegmentBuffer`; `supportsRetainedEventSync` toggled at runtime; `'dispatchEvent'` subscription replaced with `Event.SEGMENT_COMMITTED` + bounded dedup before calling `disperseToSubs`.
- **`lib/masterfree/storage.ts`**: `EventStorageTask` registers `fox.storage.history.fetch.<shardTag>` per owned shard on its sys-realm API; bridges a minimal `STORAGE_NODE_CONNECTED` announcement to the connecting entry via `pipe()`; publishes `Event.SEGMENT_COMMITTED` (the same commit `dbFactory.emit()`s locally) right after `commit_segment` resolves, and pipes it to every connected entry in `listenEntry`; the standalone `dispatchCommittedEvents` method it briefly gained is gone.
- **`lib/sqlite/history.ts`**: `getEventHistory` used as-is; no changes needed (shard filtering happens in the RPC handler using the already-returned `shard` field per row).
- **`lib/masterfree/hyper.h.ts`**: New event constant `STORAGE_NODE_CONNECTED` (payload: `{ nodeId }`); new types for the per-shard RPC request/progress payload; `SEGMENT_COMMITTED` promoted from `segment_types.ts`'s local-only constant to a proper `Event.SEGMENT_COMMITTED`, with `CommittedSegmentRecord` and `BODY_SEGMENT_COMMITTED` now defined here as the canonical wire types (`segment_types.ts` re-exports them for the pre-existing local `EventEmitter` consumers).
- New file **`lib/masterfree/net_sub.ts`**: `NetSubStatusFactory` (connection-existence tracking only), `SharedSegmentBuffer` (fixed-shard-range fetch), `ActorNetSub`.
- No schema changes; no client-facing API changes (the live-tail fix makes existing plain `SUBSCRIBE` calls on distributed realms start working — a behavior fix, not a new API surface).
