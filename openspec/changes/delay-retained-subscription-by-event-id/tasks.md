## 1. Core Changes in lib/realm.ts

- [ ] 1.1 Update `ActorTrace` class to include `after_event_id` in its properties and extract it from message options in the constructor.
- [ ] 1.2 Extend `BaseEngine` class with `currentRetainedEventId: string | null` and a list of pending retained-event waiters.
- [ ] 1.3 Implement `BaseEngine.waitForRetainedEventId(eventId: string, actor: ActorTrace): Promise<void>` to wait for a committed retained-storage event ID.
- [ ] 1.4 Implement `BaseEngine.resolveRetainedEventWaiters(eventId: string)` to notify waiters only after retained storage commit.
- [ ] 1.5 Implement cleanup for retained-event waiters on unsubscribe and session cleanup.
- [ ] 1.6 Add a bounded timeout for retained-event waiters and remove waiters when the timeout elapses.
- [ ] 1.7 Modify `BaseEngine.doTrace` to check for `after_event_id` and use `waitForRetainedEventId` before fetching retained state if requested.
- [ ] 1.8 Keep subscription registration and live event delivery immediate while only retained replay is delayed.

## 2. Engine and Storage Integration

- [ ] 2.1 Update `DbEngine.doPush` in `lib/sqlite/dbengine.ts` to call `resolveRetainedEventWaiters` only after `updateKvFromActor(actor)` resolves for retained publishes.
- [ ] 2.2 Ensure non-retained publishes do not advance `currentRetainedEventId`.
- [ ] 2.3 Implement in-memory retained event IDs for `BaseEngine`/`MemKeyValueStorage` so retained publishes get comparable local event IDs.
- [ ] 2.4 Resolve retained waiters for the in-memory engine only after `MemKeyValueStorage.setKeyActor(actor)` updates retained state.
- [ ] 2.5 Defer full Masterfree/network support until the open network commit-signal issue is resolved.

## 3. Gateway Updates

- [ ] 3.1 Verify `lib/wamp/gate.ts` handlers correctly pass the `after_event_id` option from WAMP messages to the realm command.
- [ ] 3.2 Validate `after_event_id` values and reject invalid values with a WAMP error.

## 4. Testing and Verification

- [ ] 4.1 Create a new shared test file `test/70.retained_sync.ts` that runs the same cases against in-memory and SQLite engine fixtures.
- [ ] 4.2 Implement engine fixtures for in-memory and SQLite `DbEngine`.
- [ ] 4.3 Implement a test case where a subscription with `after_event_id` is made before the event is published, and verify retained state is received only after the event is processed.
- [ ] 4.4 Implement a test case where `after_event_id` is already passed, and verify retained state is received immediately.
- [ ] 4.5 Implement a test case where the retained wait is not satisfied until the retained KV commit completes.
- [ ] 4.6 Implement a test case where unsubscribe/session cleanup removes a pending waiter and no retained event is sent.
- [ ] 4.7 Implement a test case for timeout cleanup of an unreachable but valid `after_event_id`.
- [ ] 4.8 Implement a test case where `after_event_id` without `retained` or `retainedState` does not delay live event delivery.
- [ ] 4.9 Implement a test case covering `after` history replay together with `after_event_id` retained replay.
- [ ] 4.10 Add a network-mode test or explicit assertion that network `after_event_id` support is gated until the commit signal is defined.

## 5. Documentation

- [ ] 5.1 Update root `README.md` to document the new `after_event_id` option in the "Retained Storage" section.
- [ ] 5.2 Document supported engines, timeout behavior, and the fact that live events may arrive before delayed retained replay.

## 6. Open Issues To Resolve Before Network Implementation

- [ ] 6.1 Define network commit visibility from storage nodes back to the serving `NetEngine`.
- [ ] 6.2 Confirm how network retained key-value state is updated and read.
- [ ] 6.3 Define network event ID format and comparator.
