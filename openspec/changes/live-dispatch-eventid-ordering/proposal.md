## Why

On a distributed (`NetEngine`) realm, a consumer of `Event.SEGMENT_COMMITTED` can observe an event with a smaller `eventId` after it already observed one with a larger `eventId`. `NetEngineMill.dispatchLiveEvents` (`lib/masterfree/netengine.ts`) dispatches each incoming broadcast to `disperseToSubs` immediately, in broadcast-arrival order, with only exact-`eventId` de-duplication (`SeenEventWindow`) in front of it — nothing reorders or holds back events by `eventId`. Storage nodes broadcast `SEGMENT_COMMITTED` independently per shard, on fully independent timelines, and a single realm's traffic routinely spans multiple shards. A fast shard can commit and broadcast a larger `eventId` before a slower shard commits and broadcasts a smaller (logically earlier) one, and the consumer sees them in that same, wrong order. This violates an invariant every consumer of an event stream reasonably assumes and that is currently only implicit, never stated or enforced.

The problem is not specific to WAMP subscribers. Any process that subscribes to the raw `SEGMENT_COMMITTED` broadcast on an entry's sys realm has it — in particular the KV-node process designed in `openspec/changes/add-kv-node-process/`, whose `WireSegmentCommittedSource` subscribes to that same broadcast independently of `NetEngineMill`. Ordering applied privately inside `NetEngineMill` before `disperseToSubs` would never reach such a consumer, so the fix has to be a shared mechanism, not a change local to `NetEngineMill`.

## What Changes

- Document the missing invariant as a spec requirement: for a given subscription, live delivery never presents an `eventId` smaller than one already delivered to it.
- Specify the fix as a **shared marker-then-fetch component**: `SEGMENT_COMMITTED` is treated as a sync marker whose `segment` id is sorted per source; a consumer tracks the latest marker per emitting origin, computes a stable point W (the highest id every shard's coverage has reached), fetches `(lastDelivered, W]` via the existing per-shard history RPC, merges the per-shard results by `eventId`, and delivers in order. The component lives beside `SharedSegmentBuffer` in `net_sub.ts`, is free of `NetEngineMill`/`BaseRealm` dependencies, and is instantiated by each consumer (entry live dispatch now, KV-nodes via `add-kv-node-process`). One cursor serves both catch-up and live tail.
- Add two **additive** wire fields: an optional `untilEventId` on the per-shard history fetch request (inclusive upper bound; absent keeps today's behavior), and an `origin` field on `SEGMENT_COMMITTED` identifying the emitting node so a consumer knows which host it is still waiting for. A shard tag was rejected in favor of `origin` because markers also pass through nodes that have no shard. **BREAKING: none** — both fields are backward compatible.
- Add an **idle-source ack** so a quiet shard's marker keeps advancing: a low-frequency, per-shard timer synthesizes a ping through the existing `GENERATE_DRAFT`→`ADVANCE_SEGMENT_RESOLVED` pipeline, which requires changing the storage-side empty-commit branch and broadcast guard in `EventStorageTask`.
- Record the root cause, the exact failure scenario, and the settled design in `design.md`; scope the regression test, the wire additions, the idle-source ack and the shared component as pending tasks. This change does not implement any of them yet, and leaves a small set of sub-decisions open (origin-to-shard mapping, where the ping timer lives, threshold, release scope) — see `design.md` Open Questions and `tasks.md` 2.1.

## Capabilities

### New Capabilities

- `net-live-dispatch-ordering`: The ordered-delivery guarantee for `SEGMENT_COMMITTED` consumers, together with the two wire-contract requirements it depends on (`origin` on the marker, `untilEventId` on the history fetch). Kept as its own capability because the capabilities those requirements properly belong to — `net-live-dispatch` and `net-history-fetch` — currently exist only under `openspec/changes/net-subscription/specs/` (that change is implemented per its `tasks.md` but not yet archived into `openspec/specs/`), so there is no main spec for this change to hold a delta against. Once `net-subscription` archives, the wire-contract requirements should be folded into those capabilities and the ordering requirement into `net-live-dispatch` as a follow-up (noted in `design.md`); until then this stands alone to avoid colliding with the pending change's own spec deltas.

### Modified Capabilities

*(none — see the note above on why `net-live-dispatch` and `net-history-fetch` are not listed here)*

## Impact

- `lib/masterfree/netengine.ts` — `NetEngineMill.dispatchLiveEvents` is switched to consume the shared component's ordered output (not changed in this pass).
- `lib/masterfree/net_sub.ts` — home of the new shared marker-then-fetch component; `SeenEventWindow` stays in front of it, and `SharedSegmentBuffer`'s merge logic may be reused (not changed in this pass).
- `lib/masterfree/storage.ts` — `handleHistoryFetch` gains the `untilEventId` bound; the `commit_segment` empty-buffer branch and the `if (result.events.length > 0)` broadcast guard change for the idle-source ack, gated on an explicit shard-ownership check; `origin` is stamped on the broadcast (not changed in this pass).
- `lib/masterfree/hyper.h.ts` — `HistoryFetchRequest` and `BODY_SEGMENT_COMMITTED` gain the two additive fields (not changed in this pass).
- Home of the idle-source ping timer — storage, sync or entry, undecided (see `design.md` Open Questions).
- `openspec/changes/add-kv-node-process/` — a dependent consumer: its Decision 7 (interim ordering guard) and tasks 2.5a/2.6 now refer to this change's shared component as the eventual replacement. Its `WireSegmentCommittedSource` is not fixed by this change unless it adopts the component.
- `lib/realm.ts` — `BaseRealm.disperseToSubs` / `ActorTrace.delayEvent`/`flushDelayStack` are downstream of the dispatch path and relevant context for the fix, unchanged in this pass.
- `openspec/changes/net-subscription/` — read-only prior art for this change; not modified or archived here.
- `openspec/specs/distributed-mode.md` — read-only prior art (Stateless Voting Invariants, Monotonic IDs); not modified here.
- No implementation or test files are added or modified in this pass — planning artifacts only.
