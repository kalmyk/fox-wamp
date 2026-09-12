## Why

On a distributed (`NetEngine`) realm, a live subscriber can receive a `SEGMENT_COMMITTED`-sourced event with a smaller `eventId` after it already received one with a larger `eventId`. `NetEngineMill.dispatchLiveEvents` (`lib/masterfree/netengine.ts`) dispatches each incoming broadcast to `disperseToSubs` immediately, in broadcast-arrival order, with only exact-`eventId` de-duplication (`SeenEventWindow`) in front of it — nothing reorders or holds back events by `eventId`. Storage nodes broadcast `Event.SEGMENT_COMMITTED` independently per shard, on fully independent timelines, and a single realm's subscribers routinely span multiple shards. A fast shard can commit and broadcast a larger `eventId` before a slower shard commits and broadcasts a smaller (logically earlier) one, and the entry delivers them to the subscriber in that same, wrong order. This violates an invariant every consumer of a live event stream reasonably assumes and that is currently only implicit, never stated or enforced.

## What Changes

- Document the missing invariant explicitly as a spec requirement: a subscriber's live event stream must never deliver an `eventId` smaller than one already delivered to that same subscription.
- Add a design record of the confirmed root cause, the exact failure scenario, and candidate fix approaches (buffering/merge-by-`eventId` on the live path, or a delivered-high-watermark that holds back lower `eventId`s) for a follow-up implementation pass to choose from.
- Scope a regression test and the eventual fix as pending tasks; this change does not implement either yet.

## Capabilities

### New Capabilities

- `net-live-dispatch-ordering`: The delivery-order guarantee for the live-tail dispatch path — a subscriber-facing invariant layered on top of (and currently unenforced by) `net-live-dispatch`'s broadcast/dedup mechanics. Kept as its own capability rather than folded into `net-live-dispatch` because that capability's spec currently lives only under `openspec/changes/net-subscription/specs/net-live-dispatch/` (that change is implemented per its `tasks.md` but not yet archived into `openspec/specs/`) — there is no `openspec/specs/net-live-dispatch/spec.md` yet for this change to hold a delta against. Once `net-subscription` archives, `net-live-dispatch-ordering`'s requirement should be folded into `net-live-dispatch` as a follow-up (noted in design.md); until then this stands alone to avoid colliding with or duplicating the pending change's own spec delta.

### Modified Capabilities

*(none — see note above on why `net-live-dispatch` itself is not listed here)*

## Impact

- `lib/masterfree/netengine.ts` — `NetEngineMill.dispatchLiveEvents` is the eventual fix target (not changed in this pass).
- `lib/masterfree/net_sub.ts` — `SeenEventWindow`, and possibly `SharedSegmentBuffer`-style buffering reused/extended for the eventual fix (not changed in this pass).
- `lib/realm.ts` — `BaseRealm.disperseToSubs` / `ActorTrace.delayEvent`/`flushDelayStack` are downstream of the dispatch path and relevant context for the fix, unchanged in this pass.
- `openspec/changes/net-subscription/` — read-only prior art for this change; not modified or archived here.
- `openspec/specs/distributed-mode.md` — read-only prior art (Stateless Voting Invariants, Monotonic IDs) for this change; not modified here.
- No implementation or test files are added or modified in this pass — planning artifacts only.
