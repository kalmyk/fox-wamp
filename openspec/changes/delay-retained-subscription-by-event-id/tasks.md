## 1. Core Changes in lib/realm.ts

- [x] 1.1 Update `ActorTrace` class to include `after` in its properties and extract it from message options in the constructor.
- [x] 1.2 Extend `BaseEngine` class with `currentRetainedEventId: string | null` and a list of pending retained-event waiters.
- [x] 1.3 Implement `BaseEngine.waitForRetainedEventId(eventId: string, actor: ActorTrace): Promise<void>` to wait for a committed retained-storage event ID.
- [x] 1.4 Implement `BaseEngine.resolveRetainedEventWaiters(eventId: string)` to notify waiters only after retained storage commit.
- [x] 1.5 Implement cleanup for retained-event waiters on unsubscribe and session cleanup.
- [x] 1.6 Add a bounded timeout for retained-event waiters and remove waiters when the timeout elapses.
- [x] 1.7 Modify `BaseEngine.doTrace` to check for `after` and use `waitForRetainedEventId` before fetching retained state if requested.
- [x] 1.8 Keep subscription registration and live event delivery immediate while only retained replay is delayed.

## 2. Engine and Storage Integration

- [x] 2.1 Update `DbEngine.doPush` in `lib/sqlite/dbengine.ts` to call `resolveRetainedEventWaiters` only after `updateKvFromActor(actor)` resolves for retained publishes.
- [x] 2.2 Ensure non-retained publishes do not advance `currentRetainedEventId`.
- [x] 2.3 Ensure retained publishes have comparable event IDs before retained storage writes.
- [x] 2.4 Resolve retained waiters for the in-memory engine only after `MemKeyValueStorage.setKeyActor(actor)` updates retained state.
- [x] 2.5 Defer full Masterfree/network support until the open network commit-signal issue is resolved.

## 3. Gateway Updates

- [x] 3.1 Verify `lib/wamp/gate.ts` handlers correctly pass the `after` option from WAMP messages to the realm command.
- [x] 3.2 Validate `after` values and reject invalid values with a WAMP error.

## 4. Testing and Verification

- [x] 4.1 Create a new shared test file `test/70.retained_sync.ts` that runs the same cases against in-memory and SQLite engine fixtures.
- [x] 4.2 Implement engine fixtures for in-memory and SQLite `DbEngine`.
- [x] 4.3 Implement a test case where a subscription with `after` is made before the event is published, and verify retained state is received only after the event is processed.
- [x] 4.4 Implement a test case where `after` is already passed, and verify retained state is received immediately.
- [x] 4.5 Implement a test case where the retained wait is not satisfied until the retained KV commit completes.
- [x] 4.6 Implement a test case where unsubscribe/session cleanup removes a pending waiter and no retained event is sent.
- [x] 4.7 Implement a test case for timeout cleanup of an unreachable but valid `after`.
- [x] 4.8 Implement a test case where `after` without `retained` or `retainedState` does not delay live event delivery.
- [x] 4.9 Implement a test case covering `after` history replay together with `after` retained replay.
- [x] 4.10 Add a network-mode test or explicit assertion that network `after` support is gated until the commit signal is defined.

## 5. Documentation

- [x] 5.1 Update root `README.md` to document the new `after` option in the "Retained Storage" section.
- [x] 5.2 Document supported engines, timeout behavior, and the fact that live events may arrive before delayed retained replay.

## 6. Open Issues To Resolve Before Network Implementation

- [ ] 6.1 Define network commit visibility from storage nodes back to the serving `NetEngine`.
- [ ] 6.2 Confirm how network retained key-value state is updated and read.
- [ ] 6.3 Define network event ID format and comparator.
