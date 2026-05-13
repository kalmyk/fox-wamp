## 1. Core Changes in lib/realm.ts

- [ ] 1.1 Update `ActorTrace` class to include `after_event_id` in its properties and extract it from message options in the constructor.
- [ ] 1.2 Extend `BaseEngine` class with `currentEventId: string | null` and a list of pending `eventWaiters`.
- [ ] 1.3 Implement `BaseEngine.waitForEventId(eventId: string): Promise<void>` to allow components to wait for a specific ID.
- [ ] 1.4 Implement `BaseEngine.resolveEventWaiters(eventId: string)` to notify and resolve waiters when an event ID is reached.
- [ ] 1.5 Modify `BaseEngine.doTrace` to check for `after_event_id` and use `waitForEventId` before fetching retained state if requested.

## 2. Engine and Storage Integration

- [ ] 2.1 Update `DbEngine.doPush` in `lib/sqlite/dbengine.ts` to call `resolveEventWaiters` after an event ID is assigned and the event is processed.
- [ ] 2.2 Update `Masterfree` storage/synchronizer in `lib/masterfree/storage.ts` or related files to call `resolveEventWaiters` when a segment is resolved and committed.

## 3. Gateway Updates

- [ ] 3.1 Verify `lib/wamp/gate.ts` handlers correctly pass the `after_event_id` option from WAMP messages to the realm command.

## 4. Testing and Verification

- [ ] 4.1 Create a new test file `test/70.retained_sync.ts` to verify the functionality.
- [ ] 4.2 Implement a test case where a subscription with `after_event_id` is made before the event is published, and verify retained state is received only after the event is processed.
- [ ] 4.3 Implement a test case where `after_event_id` is already passed, and verify retained state is received immediately.

## 5. Documentation

- [ ] 5.1 Update root `README.md` to document the new `after_event_id` option in the "Retained Storage" section.
