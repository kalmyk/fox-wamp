## Why

KV subscribers today only ever receive the new value on change (or nothing at all — `retained: true` subscribers on both local engines, SQLite `DbEngine` and the in-memory `MemEngine`, currently get no live updates past their initial snapshot; see design.md for how this was confirmed). There is no way to know what a value changed *from*, or to reliably resume a change stream after a disconnect without re-diffing state yourself. The `update_history_${realmName}` table (from `trace-kv-history`) already records the old and new value for every KV write, and every event already carries a globally sortable ID — the only missing piece is exposing that as a proper change-data-capture feed on SUBSCRIBE.

## What Changes

- Add a new `cdc: true` option to WAMP `SUBSCRIBE` and the Hyper API `subscribe` call. When set, delivered events use a Debezium-style change envelope instead of the plain new-value payload: `{ before, after, op, source: { offset } }`.
  - `op` is a single letter: `c` (create), `u` (update), `d` (delete), `r` (read/snapshot).
  - `op` is derived from the underlying before/after values (`before === null` → `c`, `after === null` → `d`, otherwise `u`); retained-state replay events use `op: 'r'` with `before: null`.
  - `source.offset` is the event's existing eventId/msg_id — the same ID already accepted by the existing `after: <eventId>` SUBSCRIBE resume option, so a CDC stream is resumable with no new position-tracking concept.
- Fix live post-merge dispatch on **both** local engines — a prerequisite CDC cannot work without, and confirmed during design review to affect both engines, not just one:
  - `lib/mono/dbengine.ts` `DbEngine`: dispatch a live event after a KV write completes (including `when`/`watch` resolutions). Today `doPushFinal` never dispatches a post-merge event at all.
  - `lib/mono/memengine.ts` `MemEngine`: its `saveChangeHistory` override records history but never calls `disperseToSubs`, so the existing `{ retained: true, delta: true }` re-dispatch already performed by `lib/mono/memkv.ts` `MemKeyValueStorage.setKeyActor`'s `pubWhile` never reaches a live subscriber today. Retained subscribers on the common single-process (`fox_router.ts`) engine pairing currently get zero live updates after their initial snapshot, same as SQLite.
- Reject `cdc: true` on engines that don't support it (distributed `NetEngine`), via a new `supportsCdcSubscription` capability flag on `BaseEngine`, mirroring the existing `supportsSnapshotSubscription` / `supportsRetainedEventSync` pattern.

## Capabilities

### New Capabilities
- `kv-cdc-subscription`: Debezium-style change-data-capture delivery for KV subscriptions — the `cdc` SUBSCRIBE option, the change envelope shape, op derivation, and engine support/rejection rules.

### Modified Capabilities
(none — no existing spec's documented requirements change; the `DbEngine` live-dispatch fix is new behavior introduced to support `kv-cdc-subscription` and is specified there)

## Impact

- `lib/realm.ts`: SUBSCRIBE option validation (`cdc` boolean + engine-support check, alongside existing `snapshot`/`after` validation), `ActorTrace` envelope construction for CDC-flagged subscriptions, `BaseEngine.supportsCdcSubscription` flag.
- `lib/mono/dbengine.ts`: live dispatch of merged before/after result after `writeKvLocked` and after `when`/`watch` resolutions in `applyKvActorLocked`.
- `lib/mono/memengine.ts`: fix `saveChangeHistory` to call `disperseToSubs` in addition to `keepMemHistory`, so the existing delta re-dispatch actually reaches subscribers.
- `lib/mono/memkv.ts`: extend existing post-merge dispatch to carry before/after data.
- `lib/sqlite/sqlitekv.ts`, `lib/sqlite/update_history.ts`: read path for before/after values (already written by `trace-kv-history`'s `writeKvLocked`/`saveUpdateHistory` — no schema change expected).
- `lib/masterfree/netengine.ts`: reject `cdc: true` (unsupported engine).
- Testing: new subscribe-option validation tests, envelope shape tests for create/update/delete/snapshot on both local engines.
