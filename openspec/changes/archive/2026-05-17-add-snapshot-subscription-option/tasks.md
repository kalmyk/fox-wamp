## 1. Core Changes in lib/realm.ts

- [x] 1.1 Update `ActorTrace` class to include `snapshot: boolean` in its properties and extract it from message options in the constructor.
- [x] 1.2 Modify `BaseEngine.doTrace` to coordinate history and retained replay completion using promises.
- [x] 1.3 Implement automatic snapshot termination in `doTrace` when `snapshot: true` and all replays are finished, cleaning up router/session subscription state without processing an `UNSUBSCRIBE` command.
- [x] 1.4 Update `ActorTrace.filter` to suppress live events for snapshot subscriptions.
- [x] 1.5 Update `BaseRealm.cmdTrace` to validate the `snapshot` option.

## 2. Hyper API Changes in lib/hyper/client.ts

- [x] 2.1 Update `HyperClient.subscribe` to pass the `snapshot` flag in the `id` container.
- [x] 2.2 Modify `HyperApiContext.sendSubscribed` to skip promise resolution if `snapshot` is true.
- [x] 2.3 Add a snapshot completion path that resolves the pending Hyper API `subscribe` promise when the server terminates the snapshot subscription.

## 3. Gateway Updates

- [x] 3.1 Update `lib/wamp/gate.ts` to ensure the `snapshot` option is passed from WAMP `SUBSCRIBE` messages.
- [x] 3.2 Update `lib/mqtt/gate.ts` to support the `snapshot` option in subscription logic.

## 4. Testing and Verification

- [x] 4.1 Create a new test file `test/71.snapshot_subscription.ts` to verify snapshot behavior.
- [x] 4.2 Implement a test case for snapshot with retained data only.
- [x] 4.3 Implement a test case for snapshot with history data only.
- [x] 4.4 Implement a test case for snapshot with both retained and history data.
- [x] 4.5 Implement a test case for snapshot with no data (immediate subscription termination).
- [x] 4.6 Verify that live events are NOT delivered to snapshot subscribers during replay.
- [x] 4.7 Verify that the Hyper API `subscribe` promise resolves correctly after snapshot termination.
- [x] 4.8 Explicitly validate that all event callbacks are executed before the Hyper API `subscribe` promise resolves for a snapshot.

## 5. Documentation

- [x] 5.1 Update root `README.md` to document the new `snapshot` option in the "Subscribe Options" section.
- [x] 5.2 Update `openspec/apis/wamp.md` and `openspec/apis/hyper.md` with the `snapshot` attribute description.
