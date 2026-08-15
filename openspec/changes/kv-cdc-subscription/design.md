## Context

KV state changes flow through two local engines today. Both were originally assumed (in an earlier draft of this design) to already deliver live post-merge updates to `retained: true` subscribers via the existing `opt.delta` mechanism, with only `DbEngine` missing it. Tracing the actual dispatch path (during review, before implementation started) showed that assumption was wrong for **both** engines — there is no working reference pattern to mirror, and this is a pre-existing bug independent of CDC:

- `MemKeyValueStorage` (`lib/mono/memkv.ts`): on every write, merges the new data over the old (`deepDataMerge`), then calls `this.saveChangeHistory(new ActorPushKv(..., { retained: true, delta: true, trace: true }))`. That callback was bound in `registerKeyValueEngine` (`lib/realm.ts:1242-1247`) to `this.engine.saveChangeHistory.bind(this.engine)` — i.e. whichever concrete engine owns this KV. For the common single-process pairing (`fox_router.ts`: `MemEngine` + `MemKeyValueStorage`), that resolves to `MemEngine.saveChangeHistory` (`lib/mono/memengine.ts:35-37`), which only calls `keepMemHistory(this._outMsg, actor)` — it sets an event ID and pushes into `_outMsg`, and **never calls `disperseToSubs`**. `_outMsg` is written in exactly one place and read in zero places anywhere in `lib/` or `test/` — the delta event never reaches a live subscriber. (The plain `BaseEngine.saveChangeHistory` default *does* call `disperseToSubs`, so the sys-realm's internal `MemKeyValueStorage` pairing in `lib/masterfree/netengine.ts:112-115` — which uses a bare `BaseEngine` — is unaffected. But that pairing is internal coordination state, not user-facing KV.)
- `DbEngine` (`lib/mono/dbengine.ts`): `writeKvLocked` (`lib/sqlite/sqlitekv.ts`) already computes `oldData`/`newData` and records both in `update_history_${realmName}` (via `saveUpdateHistory`), but `doPushFinal` never dispatches a post-merge event at all — no second dispatch call exists, working or not.

`ActorTrace.filter()` (`lib/realm.ts:232-246`) only delivers live events to `retained: true` subscribers when the event carries `opt.retained` (replay) or `opt.delta` (the intended post-merge live-update path) — the raw pre-merge publish is filtered out for `retained: true` subscribers on every engine by design. Net effect confirmed by code tracing and by the absence of any test exercising `opt.delta` (`grep -rn "delta" lib/ test/` returns only the 3 definition sites): **retained subscribers on both `MemEngine` and `DbEngine` get zero live updates after their initial snapshot today.** `test/70.retained_sync.ts`'s closest test uses `retainedState: true` (a different flag whose `filter()` gate doesn't block raw live events in the first place), so it never exercises this path either.

`update_history_${realmName}` (populated by `trace-kv-history`, not yet archived at proposal time) already has exactly the before/after shape a CDC feed needs: `msg_oldv`, `msg_newv`, keyed by `topic` with a causal `old_updated_by_msg_id` chain. Event IDs (`msg_id`) are globally string-sortable (`lib/masterfree/makeid.ts`: date prefix + monotonic counter) and are already the resume token for the existing `after` SUBSCRIBE option (`retained-state-event-sync`).

The existing `opt.delta` flag is unrelated to this change's meaning of "change event" — it currently means "this is the correctly-merged live value, not a raw patch," and (per the above) currently reaches zero subscribers regardless of meaning. `cdc` is deliberately a separate flag/concept; this design does not repurpose or rename `delta`, but does have to make `delta`'s existing intended behavior actually work as a byproduct of making CDC work.

## Goals / Non-Goals

**Goals:**
- Deliver Debezium-shaped change events (`before`, `after`, `op`, `source.offset`) to subscribers that opt in with `cdc: true`.
- Make the envelope resumable via the existing `after: <eventId>` mechanism — no new offset/position concept.
- Fix both `DbEngine` and `MemEngine`/`MemKeyValueStorage` so retained subscribers (CDC or not) receive live post-merge updates, closing the existing gap — on both engines, not just SQLite — that blocks CDC.
- Reject `cdc: true` cleanly on engines that don't support it, following the existing `supportsSnapshotSubscription` / `supportsRetainedEventSync` rejection pattern.

**Non-Goals:**
- Distributed/`NetEngine` CDC delivery. `NetEngine` sets `supportsCdcSubscription = false`; `cdc: true` on a distributed realm is rejected the same way `snapshot: true` already is. Cluster-wide CDC would need `net-subscription`-style ordered delivery across storage nodes and is deferred.
- Schema/table changes to `update_history_${realmName}` or `kv_${realmName}` — this change is read-only against that data model.
- Tombstone/log-compaction semantics (Kafka-style null-value follow-up after a delete). Not meaningful without a compacted log; `op: 'd'` with `after: null` is sufficient here.
- Changing what plain (non-`cdc`) subscribers receive. Non-CDC retained subscribers keep seeing whatever the post-merge dispatch carries today (full new value); the `DbEngine` fix just makes that dispatch actually happen.

## Decisions

### D1: `cdc` is a SUBSCRIBE-time option, not a separate topic/procedure
**Decision:** Add `cdc: true` to the same options object as `retained`/`retainedState`/`after`/`snapshot`, validated in `lib/realm.ts` alongside them (~line 1077-1095).
**Rationale:** CDC delivery is a payload-shape modifier on top of behavior that already exists (retained replay = snapshot phase, `after` = resume point). Modeling it as a separate topic would duplicate the replay/resume machinery for no benefit.
**Alternative considered:** A dedicated `fox.kv.changes.<topic>` meta-subscription. Rejected — it would need its own replay/resume/filter logic, duplicating `ActorTrace` instead of extending it.

### D2: Envelope construction happens in `ActorTrace`/dispatch, not by re-querying `update_history`
**Decision:** The before/after values dispatched live are the same `oldData`/`newData` already computed in-line by `writeKvLocked` (SQLite) and `setKeyActor` (mem) at write time — passed straight into the dispatched event's `opt`/`data`, not looked up from `update_history` after the fact.
**Rationale:** The data is already in hand at write time in both engines; a re-query would be redundant I/O and reintroduce a race between the write and the read.
**Consequence:** `update_history` remains the durable/queryable record; the live CDC envelope is a projection of the same computation, not a second source of truth.

### D2b: The envelope is transmitted wrapped in `{ kv: ... }`, not as a bare object
**Decision:** When an event's `data` is set to the CDC envelope, it MUST be `{ kv: { before, after, op, source } }`, not `{ before, after, op, source }` directly.
**Rationale:** Every outbound delivery path in this system — the internal Hyper API client (`getBodyValue` in `lib/tools.ts`, used by `localEvent` in `lib/hyper/client.ts`), the WAMP gate (`toWampArgs` in `lib/wamp/gate.ts`), and the MQTT gate (`toMqttPayload` in `lib/mqtt/gate.ts`) — requires `data` to contain exactly one of `kv`/`payload`/`args`, or it throws (`unknown body` / `unknown body type`). A bare `{ before, after, op, source }` object matches none of those and would throw in all three gates the moment a `cdc: true` subscriber tries to receive an event — this was missed because the spec scenarios describe the envelope as the client-observed shape (post-unwrap), not the wire-level `data`. Wrapping in `{ kv: envelope }` mirrors the existing convention (`runInboundEvent` already wraps plain KV values the same way) and makes `getBodyValue()` unwrap it back to the bare envelope transparently for the client, on all three gates, with no gate-level changes needed.
**Consequence:** The shared envelope-building helper (D2/task 3.1) must return the `{ kv: ... }`-wrapped form when used to set an event's `data`, not the bare envelope. Spec scenarios describing `{ before, after, op, source: {...} }` as "the delivered event data" remain correct as the client-observed shape; they describe what the client receives after the existing unwrap, not the literal `data` field on the wire.

### D3: Op derivation is value-based, not opt-flag-based
**Decision:** `op` is derived purely from `before`/`after` nullness (`before === null → 'c'`, `after === null → 'd'`, else `'u'`), computed at dispatch time for every engine uniformly. `op: 'r'` is assigned only for retained-state initial replay events (`opt.retained` true), never for live dispatch.
**Rationale:** Keeps op derivation a pure function of the same data every consumer already sees, instead of trusting each call site to pass the right flag.

### D4: Both `DbEngine` and `MemEngine` get a direct live-dispatch fix — neither mirrors a working pattern, because neither engine has one
**Decision:** There is no existing working post-merge dispatch to mirror (see Context — `MemKeyValueStorage`'s `pubWhile` calls `saveChangeHistory`, but for the common `MemEngine` pairing that resolves to `keepMemHistory`, which never calls `disperseToSubs`). Fix both engines directly, at the point each already has `{ oldData, newData }` in hand:
- `MemEngine`: change `saveChangeHistory` (`lib/mono/memengine.ts:35-37`) so it both records history (`keepMemHistory`, preserving existing behavior/signature) **and** calls `disperseToSubs(actor.getEvent())`, mirroring what `BaseEngine.saveChangeHistory`'s default already does. This is the minimal fix — one missing call — not a redesign of `MemEngine`.
- `DbEngine`: after `writeKvLocked` succeeds (in `updateKvFromActor`/`applyKvActorLocked`, including the `findNextWhenActor` resolution loop), dispatch a live event carrying `{ oldData, newData }` via the same `saveChangeHistory`/`disperseToSubs` path, since `doPushFinal` never dispatches a post-merge event at all today.
**Rationale:** Fixing `MemEngine.saveChangeHistory` to actually call `disperseToSubs` is the smallest change that makes the existing `opt.delta` mechanism in `ActorTrace.filter()` work as it was clearly intended to (the filter logic for `opt.delta` already exists and expects this). `DbEngine` needs a dispatch call added at the equivalent point in its write path. Both fixes converge on the same envelope-construction helper (D2), so CDC delivery is uniform across engines once both are fixed.
**Risk:** This changes runtime behavior for existing retained (non-CDC) subscribers on *both* engines — they go from receiving zero live updates to receiving the merged value. This is a larger behavior change than the original draft assumed (which thought only `DbEngine` subscribers were affected). Flagged in Risks below.

### D5: `supportsCdcSubscription` capability flag on `BaseEngine`
**Decision:** New boolean, `true` for `BaseEngine`/`DbEngine` (after D4 lands), `false` for `NetEngine`. Checked at SUBSCRIBE time next to the existing `supportsSnapshotSubscription` check.
**Rationale:** Directly mirrors the existing rejection pattern for `snapshot`; keeps engine capability discovery consistent instead of introducing a new mechanism.

### D6: Single-letter op codes (`c`/`u`/`d`/`r`)
**Decision:** Use Debezium's literal single-letter op codes rather than spelled-out words.
**Rationale:** Explicit user preference; also keeps the envelope directly recognizable to anyone who has used Debezium/CDC tooling before.

## Risks / Trade-offs

- **[Risk] D4 changes existing behavior for non-CDC retained subscribers on *both* engines** (they start receiving live updates they didn't before) → **Mitigation:** this is a bug fix bringing both engines to the behavior `ActorTrace.filter()`'s `opt.delta` branch was clearly written to support, not a new capability; call it out explicitly in the changelog/PR description so it isn't mistaken for a silent behavior change, and flag it prominently since it's a larger-than-originally-scoped fix (two engines, not one). No spec elsewhere currently asserts "retained subscribers receive no live updates," so this isn't a documented-behavior regression — but it is a bigger blast radius than the original draft of this design assumed, since any existing deployment relying on `MemEngine` + `retained: true` subscriptions was silently getting snapshot-only behavior and will now start getting live updates too.
- **[Risk] Envelope shape divergence between engines** if mem and SQLite compute `before`/`after` slightly differently (e.g., serialization) → **Mitigation:** both already funnel through the same `deepDataMerge`/`makeDataSerializable` helpers in `lib/realm.ts`; envelope construction should be a single shared function, not duplicated per engine.
- **[Risk] CDC envelope fails at delivery time if not wrapped correctly** (see D2b) — a bare `{ before, after, op, source }` `data` value throws `unknown body`/`unknown body type` in all three delivery gates (Hyper API client, WAMP, MQTT) → **Mitigation:** the shared envelope helper (D2/D2b) always returns `{ kv: envelope }`; add a test that actually subscribes via each gate (not just asserts on the internal event object) so this would be caught by CI, not just code review.
- **[Risk] `when`/`watch` resolution path in `DbEngine.applyKvActorLocked` is recursive** (a resolved actor can trigger another) → **Mitigation:** dispatch one CDC event per resolution step, in the same order `findNextWhenActor` already processes them, so `source.offset` ordering stays monotonic per topic.

## Migration Plan

- Purely additive at the protocol level: no existing SUBSCRIBE option changes meaning, no schema migration (read-only against `update_history_${realmName}`/`kv_${realmName}`).
- The `DbEngine` and `MemEngine` live-dispatch fixes (D4) ship as part of this change since CDC cannot function without either; existing tests covering retained subscriptions on both engines should be extended to assert the previously-absent live delivery (see also `test/70.retained_sync.ts`, which currently has no coverage of `retained: true`'s live-delta path on either engine).
- No rollback complexity beyond reverting the change — no persisted state format changes.

## Open Questions

- Should the `DbEngine`/`MemEngine` live-dispatch fix (D4) be split into its own prerequisite change, given it affects non-CDC retained-subscriber behavior on two engines (a bigger blast radius than the single-engine fix originally scoped)? Decision as of this review: keep it bundled in `kv-cdc-subscription`, since it has no independent motivation outside enabling CDC and splitting it would just delay the same review. Revisit only if implementation surfaces test breakage wide enough to warrant landing the fix and stabilizing it separately first.
