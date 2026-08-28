# Design: net-subscription

## Context

`NetEngine` (the distributed engine used by entry nodes) has a stub `getHistoryAfter` that returns an empty result. `supportsRetainedEventSync` is `false`. This means any WAMP `SUBSCRIBE` with `options.after` on a distributed realm silently delivers no history.

**Revision (live-tail gap found during real-cluster validation, see D7/D8):** the original draft of this design assumed a plain `SUBSCRIBE` with no `after` already worked — `BaseRealm.doTrace` marks it `traceStarted = true` immediately and relies on `disperseToSubs` for live delivery, same as the local (non-`NetEngine`) case. That assumption was wrong: `NetEngine.doPush` fully overrides `BaseEngine.doPush` and never calls `disperseToSubs` — it only calls `netEngineMill.saveHistory(...)`. `NetEngineMill` even has a `'dispatchEvent'` sysApi subscription wired to call `disperseToSubs` (`lib/masterfree/netengine.ts`), but nothing anywhere ever publishes to it. So on a distributed realm, *no* subscription — with or without `after` — ever received a live event; `after`-based catch-up (this change, D1-D6) only fixed the "replay up to now" half. D7/D8 fix the other half: live events after catch-up.

The storage layer already has all the necessary pieces:
- `event_history_<realm>` table with `msg_id` ordering that is globally monotonic (segment IDs are committed with strictly increasing values by the synchronizer's `recentValue` guard; event IDs are `segmentId + keyId(offset)` which inherit that order), plus a `msg_shard` column recording which shard each event belongs to
- `getEventHistory(db, realm, { fromId, toId }, cb)` — cursor-based reader
- Progressive RPC support in `HyperClient` (`opt.progress` / `RESULT_EMIT`)
- Shared RPC registration: `BaseEngine.addSub`/`doCall` (`lib/realm.ts:634-699`) already allow multiple sessions to register the same procedure URI, and `doCall` dispatches to whichever registrant `isAble()` first — a native "pick any of N" mechanism, not something this change needs to build

The missing pieces are the network path from entry to storage and the buffering / actor wiring on the entry side.

**Revision note:** an earlier draft of this design had the entry track connected storage nodes per shard (`NodeStatus[]`), compare `lastEventId` to pick a "preferred" node, and manually retry on failure — reinventing what shared RPC registration already does. That machinery has been removed in favor of registering the fetch RPC per shard tag and letting `doCall`'s existing dispatch pick a responder. See D2/D4/D5 below.

## Goals / Non-Goals

**Goals**
- Entry node can stream historical events from connected storage nodes via a per-shard `fox.storage.history.fetch.<shardTag>` RPC
- Multiple `ActorNetSub` instances for the same realm share one buffer (one fetch pass per realm per entry node)
- Events delivered to subscribers in `event_id ASC` order; violation logged as error
- A shard replicated across multiple storage nodes is served by whichever registrant is available, with no entry-side node tracking or selection logic
- `NetEngine.getHistoryAfter` drives the fetch; `supportsRetainedEventSync` enabled when at least one storage node has ever connected
- Storage nodes broadcast each newly-committed event to every connected entry in real time, so both plain and `after`-based subscriptions receive events published after they started listening — not just historical catch-up (D7)
- A shard replicated across multiple storage nodes each broadcasting the same committed event is de-duplicated on the entry side before it reaches `disperseToSubs` (D8)

**Non-Goals**
- Cross-shard merge ordering guarantees beyond best-effort (events from different shards at the same timestamp are unordered relative to each other — this is a deliberate design choice), for both historical replay and live dispatch
- Persistent cursor storage (cursor lives in memory; reconnect restarts from `afterEventId`)
- Snapshot subscription support (`supportsSnapshotSubscription` remains `false`)
- Authentication / authorisation on the history fetch RPC
- Exactly-once live delivery guarantees — D8's dedup window is bounded; a duplicate broadcast arriving after the window has evicted its event ID could in principle be delivered twice. At-least-once, effectively-once-in-practice is the target, not a formal guarantee
- Preferring a "freshest" replica when a shard has multiple registrants — any available one is accepted (see D5)

## Decisions

### D1: Event ID ordering is sufficient — no segment registry traversal for fetch

`event_history_<realm>.msg_id` sorts globally in the same order as segment commit order because:
1. The synchronizer's `recentValue` guard ensures each new `segment_id` (maxChallenger) is strictly greater than all previous ones
2. Event IDs are `segment_id + keyId(offset)`, inheriting that order

**Therefore**: `getEventHistory(db, realm, { fromId: afterEventId })` already returns events in the correct global ASC order. No need to walk `segment_registry`.

Alternative considered: Walk `segment_registry` ordered by `segment_id ASC` and emit per-segment batches. Rejected: extra complexity with no ordering benefit, since `event_history` is already ordered.

### D2: Progressive RPC, registered and called per shard tag

`fox.storage.history.fetch.<shardTag>` is a progressive RPC, registered by every storage node for each shard it owns (a node owning shards `[0,1,2,3]` registers four procedures, one per shard, all backed by the same handler closure filtering `event.shard === shardTag`). The caller provides `{ realm, afterEventId }` (the shard is already encoded in the procedure URI, not the request body). The handler streams batches of that shard's events for the realm as `opt.progress` calls. Final result is `{ done: true }`.

**Why per shard, not per realm (revised from an earlier draft):** a realm's history can span shards owned by disjoint node groups — a single whole-realm RPC to one node would silently miss shards that node doesn't own. Registering per shard means the entry's fetch loop is simply "call each of the `TOTAL_SHARDS_COUNT` shard procedures for this realm" — a fixed, known set — with no need to discover or track which physical node serves which shard. When a shard is replicated (multiple nodes own it), they register the *same* procedure URI; `doCall` (`lib/realm.ts:678-699`) already picks whichever registrant `isAble()`, so replication is handled by the existing RPC dispatch, not by new entry-side logic.

**Batching**: storage groups events by segment boundary. Each progress call is one segment's events: `{ events: [...], lastEventId: string }`. This makes the cursor natural: the caller advances `afterEventId` to `lastEventId` on each batch.

**No registrant for a shard**: if a shard currently has no storage node covering it, the call fails with `ERROR_NO_SUCH_PROCEDURE` (the existing `doCall` behavior for an unregistered URI). The entry treats this as "no data available for this shard right now," not a hard failure of the realm fetch.

**Registered where, exactly (found during implementation):** `pipe()` only forwards pub/sub events — it does not bridge RPC registrations across `Router`/`BaseRealm` objects. An entry's `sysApi.callrpc(...)` can only ever reach a registrant living on the entry's *own* realm object. For a storage node on a genuinely separate `Router` (the real network topology), registering only on its own local realm (`this.api`) would make the procedure unreachable from the entry — `doCall` would never see it. The fix: `EventStorageTask` registers each owned shard's procedure twice — once on its own local realm at construction (`this.api.register(...)`, covers same-realm tests and same-node local callers), and again in `listenEntry(client, gateId)` via `client.register(...)` — `client` being the session storage already holds into the *entry's* realm (the same session `pipe()` uses in the other direction). This is the standard way a remote peer registers a procedure on the realm it's connected to; no new mechanism was introduced. Registering per connected entry also means a storage node serving multiple entries (multiple `listenEntry` calls) is reachable from each of them.

Alternative considered: Single non-progressive call with limit/pagination. Rejected: forces multiple round-trips and buffers all events server-side before responding. Alternative considered: one whole-realm RPC per node with entry-side node tracking/selection (the original draft). Rejected: reinvents shared-registration dispatch the framework already provides, and doesn't naturally handle disjoint-shard realms without additional per-node shard-coverage bookkeeping.

### D3: SharedSegmentBuffer per realm per entry node

All `ActorNetSub` instances for the same realm on the same entry node share one fetch pass and buffer. The first subscriber triggers the fetch; subsequent subscribers attach to the in-progress buffer.

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

The buffer is append-only and never evicts (in-memory for the session lifetime). Subscribers iterate forward from their `afterEventId` position. Insertion is deduplicated by `event_id` — not because multiple nodes are queried for the same shard (only one registrant ever serves a given call, per D2), but because a *retried* call for a shard (after the previous call's connection/session failed mid-stream) may hit a different registrant that re-delivers events the failed one already streamed. See D5.

### D4: Storage node announcement on connect

When `EventStorageTask.listenEntry(client, gateId)` is called, storage announces to the connecting entry: `{ nodeId: string }`. This is now purely a reachability signal (see D5 — it no longer needs to carry `shards`/`lastEventId`, since shard coverage is expressed through which per-shard procedures the node registers, not through a separate announcement payload the entry must track).

**Delivery mechanism:** use the existing `pipe()` idiom already used for `TRIM_ADVANCE_SEGMENT` in the same function — `await this.api.pipe(client, Event.STORAGE_NODE_CONNECTED)` (storage subscribes locally and forwards to the connecting entry), then `this.api.publish(Event.STORAGE_NODE_CONNECTED, { nodeId }, { exclude_me: false })`. An earlier draft of this decision used a direct `client.publish(...)` call instead; `pipe()` is preferred because it matches the established, already-proven pattern for every other cross-node signal in `listenEntry`, rather than introducing a second idiom for the same kind of problem.

`NetSubStatusFactory` on the entry absorbs this purely to answer `hasStorageNodes(): boolean`, which gates `supportsRetainedEventSync`.

### D5: Multi-node per shard — handled by shared RPC registration, not entry-side selection

A shard can exist on more than one history node (replication). This is now handled entirely by D2's per-shard registration: nodes replicating the same shard register the same `fox.storage.history.fetch.<shardTag>` procedure, and `doCall` picks whichever registrant is available. The entry does not track which nodes exist, does not compare `lastEventId`, and does not implement fallback logic — a failed call can simply be retried, and `doCall` will route to any surviving registrant (possibly a different one, possibly the same one if it recovered) automatically.

**Revision history:** an earlier draft had the entry maintain `shardNodes: Map<shardTag, NodeStatus[]>`, select the node with the highest `lastEventId` per shard, and manually retry against an alternate on failure. That entire mechanism is removed — it duplicated dispatch logic `doCall` already provides. The one behavior carried forward is D3's event-level dedup, since a retry can still land on a different registrant than the original call and re-deliver some already-buffered events for that shard.

### D6: ActorNetSub gates live delivery until catch-up

`ActorNetSub` (realized as `ActorTrace` with a net-history driver) defers `actor.traceStarted = true` (and therefore live event delivery) until historical replay is complete. This is identical to how `DbEngine.getHistoryAfter` works today.

```
getHistoryAfter(after, uri, cbRow):
  buffer = getOrCreateBuffer(realm)
  buffer.ensureLoading(realm, after)   // calls fox.storage.history.fetch.<0..TOTAL_SHARDS_COUNT-1>
  await buffer.drainUntil(after, (event) => cbRow(event))
  // returns — realm.doTrace continues to set traceStarted = true
```

### D7: Live dispatch reuses the existing (dead) `dispatchEvent` hook, piped as `Event.SEGMENT_COMMITTED` itself

`NetEngineMill`'s constructor already subscribes to a `'dispatchEvent'` sysApi topic and calls `realm.getEngine().disperseToSubs(...)` on receipt — this is exactly the primitive live dispatch needs, it was simply never fed. Rather than invent a second delivery mechanism, this change:

1. **Revised:** an initial version of this change introduced a brand-new `Event.SEGMENT_COMMITTED` broadcast, published in addition to the pre-existing `SEGMENT_COMMITTED`, which storage already `dbFactory.emit()`s locally for `ProjectionListener`. That duplicated a payload shape (`CommittedSegmentRecord[]`) storage.ts already produces at commit time. Instead, `SEGMENT_COMMITTED` itself was promoted from a local-only `EventEmitter` event into a proper `hyper.h.ts` `Event` — `Event.SEGMENT_COMMITTED` — with a typed body `BODY_SEGMENT_COMMITTED = BODY_ADVANCE_SEGMENT_RESOLVED & { events: CommittedSegmentRecord[] }`, piped over the wire the same way every other segment event (`ADVANCE_SEGMENT_OVER`, `ADVANCE_SEGMENT_RESOLVED`, ...) already is. `DISPATCH_EVENT`/`BODY_DISPATCH_EVENT`/`DispatchEventRecord` no longer exist. `SEGMENT_COMMITTED` (the string constant re-exported from `segment_types.ts` for the local `dbFactory.emit`/`ProjectionListener` path) is now literally `Event.SEGMENT_COMMITTED` — one event, two independent delivery mechanisms (in-process `EventEmitter` for same-node listeners, piped pub/sub for cross-node).
2. `EventStorageTask`'s existing `Event.ADVANCE_SEGMENT_RESOLVED` handler (`storage.ts`) is the trigger point: immediately after `commit_segment(...)` resolves, it both `dbFactory.emit(SEGMENT_COMMITTED, result)`s (unchanged, in-process) and, when `result.events` is non-empty, `this.api.publish(Event.SEGMENT_COMMITTED, result, {exclude_me: false})`s the same `result` over the wire. A segment with zero events for this node (the "no-data" case — this node doesn't own the shard) publishes nothing. Unlike the rejected `DISPATCH_EVENT` design, there's no grouping-by-realm on the publish side — `result.events` is delivered as one flat (possibly multi-realm) batch, since a single advance/segment buffer isn't necessarily scoped to one realm.
3. `EventStorageTask.listenEntry` pipes `Event.SEGMENT_COMMITTED` to **every** connected entry (`await this.api.pipe(client, Event.SEGMENT_COMMITTED, {exclude_me: false})`), not just whichever entry originally accepted the publish — a live subscriber can be sitting on any entry node, not only the one the original publisher happened to connect to.
4. On the entry side, `NetEngineMill` subscribes to `Event.SEGMENT_COMMITTED`, and for each event record resolves `this.router.findRealm(event.realm)` individually (since one message can span realms), and — after the D8 dedup check — calls `realm.getEngine().disperseToSubs({ qid: eventId, uri, data: unSerializeData(data), opt, sid })`.

Delivery is durable-first: an event is only broadcast live after it has been committed to sqlite, not optimistically on raw ingest. This keeps "durably saved" and "visible to live subscribers" consistent with each other, and reuses a data shape (`CommittedSegmentRecord`) storage.ts already produces at that point — no new bookkeeping required on the write path.

Alternative considered: dispatch optimistically at `event_keep_advance_history` time (lower latency, before quorum/durability). Rejected for this change: the final `eventId` (`segment + keyId(offset)`) isn't known until the segment resolves, and delivering a live event before it's durable would let a subscriber see data that could theoretically vanish if `ADVANCE_SEGMENT_FAILED` retries the segment — durable-first avoids that class of bug entirely.

### D8: Bounded dedup window on the entry side for replicated shards

Every storage node replicating a shard runs its own `StageTwoTask` and independently reaches quorum on `ELECT_SEGMENT` votes (this is already true for `ADVANCE_SEGMENT_RESOLVED` today, per the storage→entry ack pipe fix that preceded this change) — so a shard replicated across N storage nodes will each independently commit the same segment and each publish their own `Event.SEGMENT_COMMITTED` for it. Every connected entry therefore receives up to N copies of the same event.

`NetEngineMill` keeps a small bounded FIFO dedup structure (`Set<string>` of recently-seen `eventId`s plus an array recording insertion order for eviction, capped at a fixed size, e.g. 5000 entries) and drops an incoming `CommittedSegmentRecord` whose `eventId` is already present before calling `disperseToSubs`. This mirrors the exact dedup approach `SharedSegmentBuffer.appendEvents` already uses for retry-overlap during historical fetch (`net-subscription-buffer`), just bounded instead of unbounded (a live-tail dedup window cannot grow for the life of the process the way a bounded historical buffer's contents can).

Alternative considered: suppress duplicate publication at the source, e.g. only the "lowest node ID" replica for a shard broadcasts. Rejected: adds cross-replica coordination/leader-election for a problem a few extra kilobytes of memory on the entry already solves for the exactly-analogous historical-replay case; also fails open if the designated leader is unreachable from a given entry while a non-leader replica is.

## Risks / Trade-offs

**[Risk] Cross-shard event ordering** — Events from shard 0 and shard 4 at the same timestamp are merged by `event_id ASC`. Since segment IDs are globally monotonic (the synchronizer enforces this), this ordering is correct. But if two segments were committed nearly simultaneously and the IDs ended up very close, the merge-sort on the entry needs to wait for both streams to confirm no earlier event is coming. Mitigation: merge with a small hold-back per stream (wait until both streams have produced an event past the merge point before emitting).

**[Risk] Buffer grows unbounded** — The `SharedSegmentBuffer` never evicts. For long-lived entry nodes with many historical events, memory grows. Mitigation: out of scope for MVP; future work to add a high-water-mark eviction.

**[Risk] Retry after mid-stream failure can land on any registrant, including a stale one** — since `doCall` picks whichever registrant is `isAble()`, a retry has no guarantee of hitting a more up-to-date replica than the one that failed. Mitigation: acceptable — all registrants for one shard are expected to converge to the same committed history over time (they're replicating the same log), and this is strictly simpler than the removed "prefer freshest" logic while giving up nothing in eventual correctness, only in how quickly a lagging replica's gap is avoided.

**[Risk] A shard with zero registrants is silently treated as "no data"** — if every node owning a shard is disconnected, `fox.storage.history.fetch.<shardTag>` calls fail with `ERROR_NO_SUCH_PROCEDURE` for that shard, and the entry proceeds as if the shard were empty rather than surfacing a gap. Mitigation: acceptable for MVP (matches existing `supportsRetainedEventSync`-gated behavior of "no data available" rather than a hard error); this also means a `SUBSCRIBE` with `after` never hangs waiting for a shard that will never respond — the fixed `TOTAL_SHARDS_COUNT` call count (never zero, never open-ended) means `SharedSegmentBuffer` always has a known, finite number of outcomes to wait on and reliably reaches `done = true`.

**[Risk] Live dispatch duplicates from replicated shards (D7/D8)** — every storage node covering a shard independently commits and broadcasts the same event, so an entry can see up to N copies (N = replication factor) of one `eventId` in quick succession. Mitigation: D8's bounded dedup window. Residual risk: if copies arrive further apart than the window's capacity (e.g. one replica is transiently slow), a duplicate could slip through and be delivered twice to a live subscriber. Accepted as a rare, low-severity trade-off (WAMP pub/sub has no built-in exactly-once contract either) rather than adding cross-replica coordination.

**[Risk] A live event committed during an in-flight catch-up fetch can be delivered twice — via replay AND via live dispatch** — `SharedSegmentBuffer.ensureLoading`'s per-shard RPC snapshot boundary is "whenever the storage-side handler happens to query `segment_registry`," which is not synchronized with `Event.SEGMENT_COMMITTED` broadcasts in any way. An event committed in the narrow window between a subscriber's `after`-fetch being issued and its handler actually running on the storage node can be captured by both the historical query (replay path) and the live broadcast (D7 path), and `BaseRealm.disperseToSubs`'s delay-stack mechanism has no cross-source dedup — it dedups replicas-of-the-same-broadcast (D8) but not "this event delivered by two different mechanisms." **This is not new to this change**: it is the same structural gap `DbEngine`'s local (non-`NetEngine`) `getHistoryAfter` already has (its DB read and `disperseToSubs` are similarly unsynchronized) — this change makes it reachable in `NetEngine` for the first time only because live dispatch (D7) previously didn't exist to race with it at all. Mitigation: out of scope for this change — matches an existing accepted characteristic of history-replay-plus-live-delivery elsewhere in the codebase, not a new regression. Future work, if ever warranted: track a per-subscription high-water-mark of the last replayed `eventId` and drop any live-dispatched event at or below it.

**[Risk] Live dispatch fan-out cost scales with entries × storage-node replicas** — each storage node pipes `Event.SEGMENT_COMMITTED` to every entry it's connected to, so a cluster with E entries and a shard replicated across R nodes produces `E × R` deliveries of one committed event cluster-wide. Mitigation: acceptable at the scale this project targets (single-digit entries/replicas per shard); if this becomes a bottleneck, a future change could have only the shard's "primary" replica (however defined) broadcast, falling back to another replica on failure — deliberately not built now (see D8's rejected alternative).

## Migration Plan

- No data migration required; `event_history_<realm>` schema unchanged
- `supportsRetainedEventSync` on `NetEngine` transitions from `false` → `true` at runtime when the first storage node connects; no restart required
- **Revised:** existing subscriptions without `after` were assumed unaffected by the original draft of this change; D7/D8 correct that assumption. Plain (non-`after`) subscriptions on a distributed realm now receive live events for the first time — this is a bug fix from the caller's perspective (a `SUBSCRIBE` that silently delivered nothing now works), but it is a real behavior change worth calling out to anyone who built workarounds (e.g. polling via repeated `after`-based subscribes) around the previous silent-no-op behavior
- The RPC naming change (`fox.storage.history.fetch.<shardTag>` instead of a single `fox.storage.history.fetch`) is internal to entry↔storage communication; no external/client-facing API changes
- The `'dispatchEvent'` string topic and its `opt.headers`-carried single-event payload (dead code, never published to) are replaced by the existing `SEGMENT_COMMITTED` event, promoted to a piped `hyper.h.ts` `Event` with a proper batch body — internal to entry↔storage communication, no external/client-facing API changes

## Open Questions

- Should `fox.storage.history.fetch.<shardTag>` filter events by URI (topic pattern) server-side, or always stream full realm history for that shard and let the entry filter? Server-side filtering reduces traffic but complicates the RPC.
- What is the maximum batch size per progress call? Fixed at 100 events? Configurable?
- Should the D8 dedup window size be configurable per deployment (larger clusters/replication factors may want a bigger window), or is a fixed constant sufficient for now?

## Verified During Review (no action needed)

- **`ERROR_NO_SUCH_PROCEDURE` is a real, catchable promise rejection for callers.** `BaseEngine.doCall` (`lib/realm.ts:678-699`) throws this synchronously when no registrant exists for a URI, but that throw happens inside `HyperClient.callrpc`'s `new Promise((resolve, reject) => {...})` executor (`lib/hyper/client.ts:199-212`) — a synchronous throw inside a Promise executor is automatically converted to a rejection per JS semantics. `sysApi.callrpc(...).catch(...)` per shard call (task 5.3) is safe as designed; no extra try/catch is needed around each call.
- **Per-shard registrations are cleaned up automatically on session teardown.** `Session.removeSub` (`lib/session.ts:105-110`) calls `engine.removeSub(...)`, wired into the existing generic `cleanupSession` path — a storage node's per-shard `fox.storage.history.fetch.<shardTag>` registrations are removed on disconnect the same way any other RPC registration is, with no new lifecycle code needed for this change.
