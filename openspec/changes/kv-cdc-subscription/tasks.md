## 1. Engine Capability Flag

- [ ] 1.1 Add `supportsCdcSubscription` to `BaseEngine` (`lib/realm.ts`), default `true`.
- [ ] 1.2 Set `supportsCdcSubscription = false` on `NetEngine` (`lib/masterfree/netengine.ts`), alongside its existing `supportsSnapshotSubscription`/`supportsRetainedEventSync` overrides.

## 2. SUBSCRIBE Option Validation

- [ ] 2.1 Validate `options.cdc` is a boolean when present, next to the existing `snapshot`/`after` validation in `lib/realm.ts` (~line 1077-1095).
- [ ] 2.2 Reject `cdc: true` with an option-not-supported WAMP error when `engine.supportsCdcSubscription` is false.
- [ ] 2.3 Store the `cdc` flag on `ActorTrace` construction alongside `retained`/`retainedState`/`snapshot`.

## 3. Change Envelope Construction

- [ ] 3.1 Add a shared envelope-building helper (e.g. in `lib/realm.ts`) that takes `{ before, after }` and produces `{ kv: { before, after, op, source: { offset } } }` — note the `{ kv: ... }` wrapper is required (see design.md D2b): every delivery gate (`lib/tools.ts` `getBodyValue`, `lib/wamp/gate.ts` `toWampArgs`, `lib/mqtt/gate.ts` `toMqttPayload`) throws on a bare `{ before, after, op, source }` object since it matches none of `kv`/`payload`/`args`. Derive `op` per the rules in `specs/kv-cdc-subscription/spec.md` (`before === null → 'c'`, `after === null → 'd'`, else `'u'`; `'r'` for replay).
- [ ] 3.2 Wire `ActorTrace.filter`/`sendEvent` (or the dispatch call sites) so `cdc: true` subscribers receive the `{ kv: envelope }`-wrapped payload as `data` instead of the plain new-value payload, for both live and retained-replay delivery.
- [ ] 3.3 Ensure non-`cdc` subscribers are unaffected — they continue to receive the plain new-value payload.

## 4. DbEngine Live Dispatch Fix

- [ ] 4.1 In `lib/mono/dbengine.ts`, after `writeKvLocked` succeeds in `applyKvActorLocked`, dispatch a live event carrying `{ oldData, newData }` via `disperseToSubs`/`saveChangeHistory` (there is no working pattern to mirror in `MemKeyValueStorage` — see 5.1 below, which fixes that engine too).
- [ ] 4.2 Apply the same dispatch inside the `findNextWhenActor` resolution loop in `applyKvActorLocked`, so `when`/`watch`-triggered writes also produce a live event, in resolution order.
- [ ] 4.3 Confirm `updated_by_msg_id`/`writeKvLocked`'s already-computed `oldData`/`newData` are passed straight into the dispatch (no re-query of `update_history`).
- [ ] 4.4 `writeKvLocked` (`lib/sqlite/sqlitekv.ts:68-113`) currently generates `updateHistoryId` internally but only returns `{ newData, whenNotMet }` — it never surfaces the ID. Add `updateHistoryId` (or equivalently, the pre-existing `origin` parameter is dead code and unrelated — do not reuse it) to the return type so `applyKvActorLocked` has the correct `source.offset` value for the live dispatch; without this there is no ID to use for the envelope.

## 5. MemEngine Live Dispatch Fix + MemKeyValueStorage Envelope Data

- [ ] 5.1 Fix `MemEngine.saveChangeHistory` (`lib/mono/memengine.ts:35-37`) to call `disperseToSubs(actor.getEvent())` in addition to its existing `keepMemHistory(this._outMsg, actor)` call. Today this override swallows the event into a write-only `_outMsg` array (confirmed: zero reads of `_outMsg` anywhere in `lib/`/`test/`) and never reaches subscribers — this is the actual bug, not just a data-shape gap.
- [ ] 5.2 Confirm `MemKeyValueStorage.setKeyActor`'s existing post-merge dispatch (`lib/mono/memkv.ts` `pubWhile`) carries both `oldData` and `newData` (currently only `newData`); extend it to pass `oldData` through so the envelope helper (3.1) has what it needs.
- [ ] 5.3 Verify the new `ActorPushKv` created in `pubWhile` still gets a valid `eventId` after 5.1's fix (it's assigned inside `keepMemHistory` before the new `disperseToSubs` call) — confirm `source.offset` in the resulting CDC envelope is non-null.

## 6. Resumability

- [ ] 6.1 Verify `source.offset` values used in change envelopes are accepted unchanged by the existing `after` SUBSCRIBE option (`retained-state-event-sync`) — no new resume-token format.
- [ ] 6.2 Add a test resuming a `cdc: true` + `retained: true` subscription via `after: <previously-seen offset>`.

## 7. Tests

- [ ] 7.1 Subscribe validation tests: `cdc` non-boolean rejected, `cdc: true` rejected on `NetEngine`, `cdc: true` accepted on mem/`DbEngine`.
- [ ] 7.2 Envelope shape tests (both engines): create (`op: 'c'`), update (`op: 'u'`), delete (`op: 'd'`) envelopes match expected `before`/`after`/`source.offset`.
- [ ] 7.2b Wire-level delivery test: subscribe with `cdc: true` through each of the internal Hyper API (`api.subscribe`), and confirm the client callback receives the unwrapped `{ before, after, op, source }` object with no thrown error (regression test for the `{ kv: envelope }` wrapping in D2b — without it this throws `unknown body`). If WAMP/MQTT gate integration tests exist for subscriptions elsewhere, extend one of them for `cdc: true` too rather than only testing at the internal-event level.
- [ ] 7.3 Snapshot/replay envelope test: `cdc: true` + `retained: true` initial replay delivers `op: 'r'` records.
- [ ] 7.4 Live-delivery regression test on **both** engines: a plain (non-`cdc`) `retained: true` subscriber now receives live updates after the initial snapshot on `DbEngine` and on `MemEngine` (previously received none on either — extend `test/70.retained_sync.ts`'s `run` matrix, which already parametrizes over both engines).
- [ ] 7.5 `when`/`watch` resolution test: a parked actor resolved via `when` produces a correctly-ordered live change envelope.
- [ ] 7.6 Offset ordering test: consecutive change events for the same topic have strictly increasing `source.offset`.

## 8. Build and Final Checks

- [ ] 8.1 Run full test suite; ensure no regressions in existing retained/snapshot/after subscription tests.
- [ ] 8.2 Update `lib/masterfree/hyper.h.ts`-adjacent docs/comments if `cdc`/envelope types are introduced as shared TypeScript types.
- [ ] 8.3 Run `openspec status --change kv-cdc-subscription` and confirm all artifacts complete.
