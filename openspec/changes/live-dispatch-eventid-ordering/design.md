## Context

See `proposal.md` - Why for motivation. This section records the confirmed root cause and the exact failure scenario in detail, since that is the primary deliverable of this planning pass.

### Confirmed call chain (live-tail path)

1. A storage node commits a segment and, per `net-subscription`'s D7 (`openspec/changes/net-subscription/design.md`), publishes `Event.SEGMENT_COMMITTED` with body `BODY_SEGMENT_COMMITTED = { ..., events: CommittedSegmentRecord[] }` (`lib/masterfree/hyper.h.ts`). This happens independently per shard, immediately after that shard's own segment durably commits — there is no cross-shard coordination on commit or broadcast timing.
2. `EventStorageTask.listenEntry` pipes `Event.SEGMENT_COMMITTED` to every connected entry (`lib/masterfree/storage.ts`).
3. On the entry, `NetEngineMill`'s constructor subscribes: `this.sysApi.subscribe(Event.SEGMENT_COMMITTED, (body) => { this.dispatchLiveEvents(body) })` (`lib/masterfree/netengine.ts:134`).
4. `NetEngineMill.dispatchLiveEvents(body)` (`lib/masterfree/netengine.ts:273`) iterates `body.events` in the order they arrive in that call, and for each:
   - Calls `SeenEventWindow.addIfNew(event.eventId)` (`lib/masterfree/net_sub.ts`) — a `Set<string>` plus an insertion-order eviction array, capped at a fixed capacity. This is **exact-match de-duplication only**: it answers "have I seen this exact `eventId` before?", never "have I already delivered something past this position?".
   - If new, immediately resolves `this.router.findRealm(event.realm)` and calls `realm.getEngine().disperseToSubs({ qid: event.eventId, ... })` — no buffering, holding, or reordering.
5. `BaseRealm.disperseToSubs` (`lib/realm.ts:868`) iterates matching subscriptions and, per subscription, calls `subD.sendEvent(event)` immediately if `traceStarted`, or `subD.delayEvent(event)` otherwise.
6. `delayEvent`/`flushDelayStack` (`lib/realm.ts:268-283`) is a plain array push, flushed in push order via a `for` loop — not sorted or re-checked against `eventId` at flush time.

**Conclusion**: at no point between a storage node's independent per-shard commit and a subscriber's delivery callback does anything compare an incoming event's `eventId` against what has already been delivered to that subscription. `dispatchLiveEvents` delivers strictly in *broadcast-arrival order*, which is not the same as *`eventId` order* once more than one shard is in play.

### Why this is reachable, not just theoretical

A single realm's subscribers commonly span multiple shards — `net-subscription`'s own design.md (D1/D2) states "a realm's history can span shards owned by disjoint node groups," which is exactly why the historical-fetch RPC (`fox.storage.history.fetch.<shardTag>`) is called once per shard tag rather than once per realm. The same fan-out applies to live dispatch: shard tags are assigned round-robin per advance (`NetEngineMill.nextShardTag`), so a moderately active realm will have events committing across many shards concurrently, each on its own storage node(s), each broadcasting independently the moment its own commit resolves. There is no bound on how far two shards' commit/broadcast timings can drift apart (GC pause, transient network delay, disk I/O stall, differing queue depth, etc.) — this is not restricted to near-simultaneous ties.

This sharpens a claim in `net-subscription/design.md`'s Non-Goals section: *"Cross-shard merge ordering guarantees beyond best-effort (events from different shards at the same timestamp are unordered relative to each other — this is a deliberate design choice), for both historical replay and live dispatch."* That phrasing frames the gap as a same-timestamp tie-break question. The actual reachable violation is broader: any two shards, with any gap between their commits, can produce out-of-order delivery on the live path — this was accepted as a Non-Goal without the live path's version of the problem being fully worked through (the historical path at least merge-sorts by `eventId` before delivery; the live path does not merge at all). This change does not silently re-litigate that Non-Goal decision — it makes the gap explicit as a spec requirement so a future change can deliberately choose to close it (or deliberately re-affirm the Non-Goal with full knowledge of its scope).

### Exact failure scenario

1. Shard A commits a segment whose events include `eventId "E100"`. Shard A's storage node publishes `Event.SEGMENT_COMMITTED({ events: [{ eventId: "E100", realm: "myapp", ... }] })`. This reaches the entry and `dispatchLiveEvents` processes it: `SeenEventWindow.addIfNew("E100")` → `true`, `disperseToSubs({ qid: "E100", ... })` is called. A live subscriber on `myapp` with `traceStarted === true` receives `"E100"` immediately via `sendEvent`.
2. Shard B, independently, was already mid-commit when shard A's broadcast went out — say shard B's storage node was momentarily slower (GC pause, disk stall, a busier segment). Shard B now commits a segment containing `eventId "E050"` — an `eventId` that sorts *before* `"E100"` (it was logically/temporally the earlier event; shard B's storage node was just slower to durably commit and broadcast it). Shard B's storage node publishes `Event.SEGMENT_COMMITTED({ events: [{ eventId: "E050", realm: "myapp", ... }] })`.
3. This reaches the entry after step 1. `dispatchLiveEvents` processes it exactly the same way: `SeenEventWindow.addIfNew("E050")` → `true` (distinct `eventId`, not a duplicate of `"E100"`), `disperseToSubs({ qid: "E050", ... })` is called. The same subscriber receives `"E050"` next.
4. The subscriber's delivery callback sequence is `["E100", "E050"]` — a smaller `eventId` delivered after a larger one. This is the invariant violation.

Nothing in steps 1-3 is anomalous or a failure condition on the storage side — StageTwo's quorum election and `commit_segment` both behaved correctly for each shard independently (see `openspec/specs/distributed-mode.md`'s Stateless Voting Invariants, "Monotonic IDs" row: `recentValue` in StageTwo only guarantees `finalId` is non-decreasing *within* a stream of segments the synchronizer is aware of — it says nothing about interleaving two independent shards' streams on the entry's receiving end). The bug is purely in the entry's live-dispatch fan-in: it has no merge/ordering step at all.

### Scoping: cross-shard vs. same-shard

- **Cross-shard (confirmed, primary scenario)**: as above. Different shards are fully independent timelines; nothing synchronizes their commit or broadcast order relative to each other.
- **Same shard, replicated storage nodes**: `SeenEventWindow` dedups by exact `eventId` match, so it provides no ordering protection either way — but replicas of the *same* shard each run their own `StageTwoTask`, and all of them vote to quorum over the *same* logical segment sequence for that shard (the shard's segments are the unit of StageTwo consensus). Because of this, replicas of one shard are expected to commit (and therefore broadcast) their segments in the same relative order as each other — the "Monotonic IDs" invariant holds *within* a shard's own segment stream across all its replicas. The clearly-reachable violation in this change is cross-shard, not same-shard.
- **Residual, lower-confidence risk**: even with consistent *logical* commit order across a shard's replicas, nothing formally guarantees message-level ordering is preserved end-to-end through independent `pipe()` sessions and the transport layer for two broadcasts from the *same* originating node. This is called out in Risks below as a residual concern, not a confirmed second root cause — the primary, well-understood failure mode this change targets is cross-shard.

## Goals / Non-Goals

**Goals:**
- State the missing per-subscription ordering invariant as an explicit, testable spec requirement (done in `specs/net-live-dispatch-ordering/spec.md`).
- Record the root cause and failure scenario precisely enough that a future implementation pass does not need to re-derive them.
- Record a concrete fix mechanism (sorted `SEGMENT_COMMITTED` sync markers, a stable point W, and a fetch-and-merge of `(lastDelivered, W]`, fed by real commits plus a sync/storage-originated idle-source ack) with enough detail to be actionable, including the two wire additions (`untilEventId`, `origin`), while leaving genuinely open sub-decisions (origin-to-shard mapping, ping timer's home, threshold value, release scope) for the implementation pass.
- Make the mechanism a reusable component that every `SEGMENT_COMMITTED` consumer shares (entry live dispatch and KV-nodes), not a fix private to `NetEngineMill`.

**Non-Goals (for this planning pass):**
- Implementing any fix. No production code changes in this change.
- Writing the regression test. Scoped as a pending task only (see `tasks.md`).
- Resolving the two related-but-separate issues noted in "Related/Adjacent Risks" below (`SharedSegmentBuffer.drainUntil`'s silent-skip behavior, and same-shard transport-level reordering) — flagged as follow-up, out of scope here.
- Deciding whether `net-live-dispatch-ordering` stays a standalone capability or is folded into `net-live-dispatch` once `net-subscription` archives — noted as a follow-up in `proposal.md`.

## Decisions

A concrete design has now emerged from this planning pass and is recorded below. It is still not implemented (see Non-Goals) — this section supersedes the earlier abstract two-candidate framing with the specific mechanism the discussion converged on, plus the exact code-level gaps that mechanism needs to close.

**Revision (marker-then-fetch):** the first version of this design merged the *pushed bodies* of `SEGMENT_COMMITTED` per shard (a k-way merge inside `NetEngineMill`). Discussion refined this: `SEGMENT_COMMITTED` is treated as a **sync marker** whose `segment` id is sorted per source, and the subscriber does not order pushed bodies — it waits until markers have arrived from every source, then **fetches** the data up to that point in sorted order. The sections below are written for that model; the per-shard-sorted precondition and the idle-source ack still apply unchanged.

### Precondition confirmed: each shard's own commit stream is already sorted

Before weighing candidates, one fact narrows the problem considerably and is worth stating precisely, since it turns this from "reorder arbitrary events" into "merge streams that are each already in order":

- `NetEngineMill.recentAdvanceStamp` (`lib/masterfree/netengine.ts:96`) is a single strictly-increasing counter per entry process. `getSegment()` assigns each new segment `Math.max(this.recentAdvanceStamp + 1, Date.now())` and advances the counter; `nextShardTag()` then round-robins which shard tag that segment belongs to. So the subsequence of segment numbers assigned to any *one* shard is a strictly-increasing subsequence of that global counter — a given shard never receives a smaller segment number than one it was already assigned.
- Within one committed segment, `dbSaveSegment` (`lib/masterfree/storage.ts:222`) assigns `eventId = segment + keyId(++offset)` in increasing-offset order as it iterates the segment's buffered events, and `commit_segment`'s returned `events` array preserves that order — the same order `SEGMENT_COMMITTED`'s `body.events` is broadcast in.
- Put together: **for a single shard, the sequence of `SEGMENT_COMMITTED` broadcasts (and the events within each) is already monotonically increasing in `eventId`.** This is not a new assumption — it's the same guarantee `openspec/specs/distributed-mode.md`'s "Monotonic IDs" invariant already relies on ("`finalId` is non-decreasing within a stream of segments the synchronizer is aware of"), just confirmed here at the code level for this specific stream.

This means the live-dispatch gap is not a general out-of-order-delivery problem needing a generic sort — it is specifically **a merge of `TOTAL_SHARDS_COUNT` already-individually-sorted streams**, one stream per shard, exactly analogous to the merge step of an external/k-way merge sort. That framing subsumes and sharpens Candidate A below: the "buffering" it describes is really the classic k-way-merge structure (a per-shard queue of pending, already-ordered events, with the globally smallest available head safe to release once you're not missing a still-pending smaller one from some other shard) — not an open-ended general reordering buffer.

### The mechanism: sorted sync markers drive a fetch-and-merge

`Event.SEGMENT_COMMITTED` is treated as a **sync marker**: its `segment` id is sorted per source (the per-shard precondition above), and the eventIds of every event inside a segment start with that `segment` string, so a marker for segment S means "everything committed by this source up to and including S is durably in `event_history_<realm>` and fetchable" (`commit_segment` saves before it broadcasts). The subscriber (an entry's live dispatch, a KV-node, any future consumer) does not order the pushed bodies. It keeps one loop:

```
latest[origin]   = highest marker segment seen from each expected origin
W                = stable point: highest id every shard's coverage has reached
                   (per shard: max over that shard's owning origins; overall: min over shards)
lastDelivered    = cursor: everything <= it has been delivered

on marker:  update latest[origin]; recompute W
if W > lastDelivered:
    fetch (lastDelivered, W] from every shard via the per-shard history RPC
    merge the results by eventId (each shard's result is already sorted)
    deliver in order; lastDelivered = W
```

Consequences worth naming:
- **One mechanism serves catch-up and live tail.** Catch-up is a fetch from `after` to W; live tail is W moving forward. There is a single cursor (`lastDelivered`), so a consumer with a separate catch-up path (the KV-node's `WireHistoryFetchSource`) has no second high-water mark to seed at the moment it goes live.
- **One shared component, not a fix private to `NetEngineMill`.** `NetEngineMill.dispatchLiveEvents` (feeding `disperseToSubs` for WAMP clients) and an external subscriber such as a KV-node's `WireSegmentCommittedSource` are independent subscribers to the *same raw* sys-realm broadcast. A reordering buffer buried inside `NetEngineMill` would never reach the second consumer. The marker-then-fetch loop must therefore live in a reusable module (`net_sub.ts`-level, alongside `SharedSegmentBuffer`) that each consumer instantiates.
- **Pushed bodies become an optimization.** A marker's inline `events` may be used to skip the fetch when the received segments are contiguous up to W; correctness never depends on them.
- **Cost is latency.** Delivery of anything above W waits for the slowest source's marker, which is why an idle source must still advance its marker (next section).

This resolves what the first version left open: the "nothing smaller is coming" signal is simply "every source's marker has reached W", instead of a separate watermark or hold-back window (a timeout remains only as the dead-source fallback described under Release scope).

### The "nothing smaller is coming" signal: an idle-shard barrier ack, riding the real consensus pipeline

This is not a new side-channel. A shard that's actively committing already advances its own watermark for free, every time it broadcasts a real `SEGMENT_COMMITTED` — the merge only needs help for shards that have gone quiet. For those, the fix is to make an idle shard periodically go through the *same* `GENERATE_DRAFT → PICK_CHALLENGER → ELECT_SEGMENT → ADVANCE_SEGMENT_RESOLVED` pipeline a real segment does, with an empty buffer, producing an intentional "still here, nothing pending" `SEGMENT_COMMITTED{events: []}` ack instead of a silent gap.

Three code-level facts make this cheaper than it sounds, and one makes it currently impossible without a fix:

1. **The empty-commit path already exists.** `EventStorageTask.commit_segment` (`lib/masterfree/storage.ts:208`), when `ADVANCE_SEGMENT_RESOLVED` arrives for a segment this node has no buffered events for, already takes a no-DB-write, `events: []` return path — it's just currently logged as `console.error("advanceStamp not found in segments [...]")`, because today that only happens by accident (a resolved segment for a shard this particular replica doesn't own). Once idle-shard resolution becomes an intentional, expected flow, this needs to become a deliberate branch — distinguishing "expected idle-shard/not-my-shard ack" from "a buffer that should have existed went missing" (a real bug) — rather than an error log.
2. **A currently-blocking guard must be relaxed.** `storage.ts:117`, right after `commit_segment` resolves: `if (result.events.length > 0) { this.api.publish(Event.SEGMENT_COMMITTED, result, ...) }` — an empty result is *never broadcast today*. This is the opposite of what the barrier needs: it must broadcast specifically *when* empty, for a legitimate idle-shard ack, or the entry never sees the watermark advance at all.
3. **That guard cannot simply be deleted, because it's currently load-bearing for a different reason.** `Event.ADVANCE_SEGMENT_RESOLVED` (`storage.ts:108`) is subscribed to with no shard filter — *every* storage node process receives *every* resolved segment cluster-wide, regardless of which shards it owns (per `EventNodeConfig.shards`/`config.findShardsForNode`), and relies on the empty-buffer outcome as an implicit "not my shard" no-op. If empty results start broadcasting unconditionally, every non-owning storage node would *also* emit a spurious empty ack for shards it has nothing to do with — harmless for correctness (the entry's `SeenEventWindow`-style dedup and a shard-keyed queue would absorb it) but noisy, and it muddies "shard confirmed idle" with "node not involved." The fix needs an explicit ownership check (`this.shards.includes(shardTag)`) so only a shard's actual owner(s) emit its idle ack — replacing the implicit empty-buffer-as-proxy-for-ownership pattern the code currently leans on.
4. **Per-shard sorted commit stream** — unchanged from the precondition already established above; the idle ack just needs to carry a segment/eventId value that fits into that same ordering (e.g. the barrier value used to synthesize the ping).

### Origin of the idle-shard ping: a low-frequency, adaptive timer

Confirmed during discussion: `GENERATE_DRAFT` today has exactly one origin — `EventStorageTask`'s handler for `Event.ADVANCE_SEGMENT_OVER` (`storage.ts:88-94`), which itself only fires because an entry closed a real segment (`NetEngineMill.event_trim_advance_segment` / `event_advance_segment_failed`). Nothing periodic exists anywhere in this pipeline today (`StageOneTask.startActualizePrefixTimer`'s 7s interval is unrelated — it only reconciles the ID generator's clock prefix).

The ping should not be a blanket poll of all `TOTAL_SHARDS_COUNT` shards on a fixed interval — a busy shard already advances its watermark via real traffic and needs no synthetic help. Instead, track `lastResolvedAt` per shard tag and only synthesize a `GENERATE_DRAFT`-equivalent ping for a shard once it's been quiet past a threshold:

```
for shard in 0..TOTAL_SHARDS_COUNT-1:
  if (now - lastResolvedAt[shard]) > PING_THRESHOLD:
      synthesize GENERATE_DRAFT(shard)   // drives the real StageOne/StageTwo pipeline,
                                          // empty buffer, "nothing pending" ack
  else:
      skip — shard's own real traffic already advanced its watermark recently
```

This bounds "how often" to "how much extra latency a genuinely idle shard is allowed to add for everyone else," rather than a fixed global chatter rate — and it self-regulates: an active realm's shards rarely if ever need a synthetic ping.

**Left open**: which process should own this timer and the `lastResolvedAt` bookkeeping. Candidates, none yet chosen:
- **Storage** — already knows its own shard ownership (`this.shards`) and already contains the `ADVANCE_SEGMENT_OVER → GENERATE_DRAFT` translation this would extend.
- **Sync** (`StageOneTask`/`StageTwoTask`) — already coordinates the voting pipeline this ping drives, and `StageTwoTask` is colocated per storage node (`bin/masterfree/ndb.ts`), so it has the same shard-ownership visibility as storage without new plumbing.
- **Entry** — owns `recentAdvanceStamp`/round-robin shard assignment and is the actual consumer of the merged output, but has no visibility into per-shard commit activity today (that lives storage/sync-side).

### Wire contract additions

Two small, additive changes to existing wire types make the marker-then-fetch loop possible:

1. **`untilEventId` on the history fetch.** `HistoryFetchRequest` (`lib/masterfree/hyper.h.ts`) is `{ realm, afterEventId }` today — no upper bound, so a consumer cannot ask for exactly `(lastDelivered, W]` and would receive (and have to discard or hold) everything committed after W. Add an optional `untilEventId: string | null` (absent/`null` keeps today's unbounded behavior, so `SharedSegmentBuffer` and every existing caller are unaffected). `EventStorageTask.handleHistoryFetch` (`lib/masterfree/storage.ts`) applies it as an inclusive upper bound on the events it streams; the cut belongs on the storage side so the excess is never sent.
2. **`origin` on `SEGMENT_COMMITTED`.** `BODY_SEGMENT_COMMITTED` (`= BODY_ADVANCE_SEGMENT_RESOLVED & { events }`) carries `advanceOwner` (the *entry* that originated the segment), but nothing identifying which node *emitted the marker*. Add `origin: string` — the id of the emitting node (a storage node id today; a KV-node id if KV-nodes relay markers) — set by the emitter, so a consumer can track `latest[origin]` and knows *which host it is still waiting for*. A shard tag was considered and rejected: markers also pass through KV-nodes, which have no shard, so a shard-keyed marker would not be uniform across emitters. `origin` is the uniform key.

Consequence of choosing `origin` over a shard tag: the marker no longer says which shard it covers, so the consumer must map origins to shard coverage from config (`eventNodes.<id>.shards`, plus `dbNodes` entries if KV-nodes relay). With replicated shards (checked-in `eventNodes`: DB1 `[0,1,2,3]`, DB2 `[2,3,4,5]`, ...) W must advance *per shard* using whichever of that shard's owning origins reports first, then take the minimum across shards — it cannot wait for every origin. That mapping is recorded as an Open Question below rather than settled here.

### Release scope: per-subscription vs. per-realm watermark

Once W is computed, the release side just needs a place to apply "highest safely-delivered `eventId` so far" (`lastDelivered`): per subscription (matches the spec's actual unit of guarantee, costs bookkeeping proportional to live subscription count) or per realm (coarser — holds back all subscribers on a realm for one lagging shard, even ones whose URI pattern is unaffected — but far cheaper, and `disperseToSubs` already fans out per-realm anyway). Still open; not blocking on anything above.

**Rejected**: dropping instead of holding a late/out-of-order event. Simplest, but a silent data-loss risk the subscriber never sees — only defensible given WAMP pub/sub's existing no-exactly-once contract (`net-subscription/design.md`'s own accepted trade-off), and even then trades one correctness bug for a different one.

**Retained as a fallback, not the primary mechanism**: a hold-back timeout (release a queue's head after a bounded wait even without a positive ack) remains worth keeping as a safety net for a shard whose storage replicas are all unreachable/wedged — the idle-shard ack is the primary "nothing smaller is coming" signal, but a completely dead shard can't ack at all, and the merge shouldn't stall every other shard's delivery indefinitely for one that's actually down. This is the same idea `net-subscription/design.md`'s Risks section proposed for historical merge but never implemented.

## Related / Adjacent Risks

Found during this review; explicitly out of scope for this change's tasks, recorded here so they are not lost.

- **[Risk] `SharedSegmentBuffer.drainUntil` can silently skip, not just delay, an out-of-order historical event.** `appendEvents` inserts an out-of-order arrival at its correct sorted position and logs `console.error('out-of-order history event delivery', ...)`, but `drainUntil`'s cursor-based delivery loop (`idx = this.events.findIndex(event => event.eventId > cursor)`) only ever looks *forward* of the cursor it has already advanced past. If a lagging shard's smaller-`eventId` event is inserted into the array *after* `drainUntil`'s cursor has already advanced beyond that position, the next iteration's `findIndex` will never find it — the event is not merely delivered late, it is never delivered to that catch-up call at all. This is a real, separate bug from the live-dispatch issue this change targets, narrower in scope (catch-up only, and only when a shard's contribution arrives unusually late relative to others). Flagged as a follow-up open question, not added to this change's tasks.
- **[Risk] Same-shard replica transport-level reordering.** As discussed in Context, logical commit order should be consistent across replicas of one shard, but nothing formally guarantees message-level delivery order survives independent `pipe()` sessions end-to-end. Lower confidence than the cross-shard scenario; worth a look if a future implementation's regression test suite ever wants to cover it, but not the primary target here.
- **[Risk] Historical replay and live dispatch have no cross-source dedup with each other** — already known and explicitly accepted in `net-subscription/design.md`'s Risks section (a live event committed during an in-flight catch-up fetch can be delivered via both paths). Restated here only because it is adjacent territory; not something this change touches.

## Migration Plan

Not applicable — no implementation in this pass. The two wire additions are backward compatible by construction: `untilEventId` is optional (absent keeps today's unbounded fetch), and `origin` is an additive field that existing consumers ignore, so storage nodes and consumers can be upgraded in any order until the sorted-sync component is switched on. A future implementation change will need its own migration plan once the open sub-decisions above are resolved — in particular: the idle-shard ping is new background traffic on the sync/storage pipeline (bounded by `PING_THRESHOLD`, but still a behavior change worth calling out), and `commit_segment`'s empty-buffer branch changing from silent error-log to intentional broadcast is a behavior change on an existing code path, similar to how `net-subscription`'s own Migration Plan flagged its live-dispatch behavior change.

## Open Questions

- **How does a consumer map `origin` to shard coverage, and which origins are "expected"?** Derived from `eventNodes` config (and `dbNodes` if KV-nodes relay markers)? What does W do while an expected origin has never been heard from (block, or treat as absent after the fallback window)? See "Wire contract additions".
- **Do KV-nodes emit or relay markers**, and if so, what does a KV-node's marker mean (its `current_position` per realm, or a forwarded storage marker)? The `origin` field is designed to be uniform across both, but the KV-node side is not specified yet.
- **Should the fetch be skipped when the inline `events` of contiguous markers already cover `(lastDelivered, W]`?** Optimization only; correctness must not depend on it.
- **Which process owns the idle-shard ping timer and `lastResolvedAt` bookkeeping** — storage, sync (`StageOneTask`/`StageTwoTask`), or entry? See Decisions; not yet chosen.
- **What `PING_THRESHOLD` is acceptable** — fixed constant, configurable per deployment (mirrors the open question `net-subscription/design.md` already left open for its dedup window size)?
- **How exactly does `commit_segment`'s empty-buffer branch distinguish an intentional idle-shard ack from a real bug** (a buffer that should have existed but didn't) once idle resolution is expected rather than accidental — does the `ADVANCE_SEGMENT_RESOLVED` body need to carry an explicit "this is a synthetic ping" marker, or is "no buffer + this node owns the shard" sufficient?
- Should the merged output's watermark be tracked per-subscription or per-realm? Left for the implementation pass, informed by whichever turns out cheaper to wire into `NetEngineMill`/`BaseRealm`'s existing subscription bookkeeping.
- What fallback window (before W advances past a shard whose owning origins are all unreachable, not just idle) is acceptable?
- Should `net-live-dispatch-ordering` be merged into `net-live-dispatch` now (by also updating the not-yet-archived `openspec/changes/net-subscription/specs/net-live-dispatch/spec.md`) rather than staying a standalone capability until archive? Left as-is for this pass per `proposal.md`'s note — revisit when `net-subscription` archives.
- Should the `SharedSegmentBuffer.drainUntil` silent-skip issue (Related/Adjacent Risks) become its own change, or be folded into whichever change ends up implementing the live-dispatch fix (since both plausibly want the same underlying ASC-merge machinery)?
