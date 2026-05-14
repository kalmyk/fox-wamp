## 1. Core Changes in lib/realm.ts

- [ ] 1.1 Update `ActorTrace` class to include `snapshot: boolean` in its properties and extract it from message options in the constructor.
- [ ] 1.2 Modify `BaseEngine.doTrace` to coordinate history and retained replay completion using promises.
- [ ] 1.3 Implement automatic `untrace` in `doTrace` when `snapshot: true` and all replays are finished.
- [ ] 1.4 Update `ActorTrace.filter` to suppress live events for snapshot subscriptions.
- [ ] 1.5 Update `BaseRealm.cmdTrace` to validate the `snapshot` option.

## 2. Hyper API Changes in lib/hyper/client.ts

- [ ] 2.1 Update `HyperClient.subscribe` to pass the `snapshot` flag in the `id` container.
- [ ] 2.2 Modify `HyperApiContext.sendSubscribed` to skip promise resolution if `snapshot` is true.
- [ ] 2.3 Modify `HyperApiContext.sendUnsubscribed` to resolve the pending snapshot promise.

## 3. Gateway Updates

- [ ] 3.1 Update `lib/wamp/gate.ts` to ensure the `snapshot` option is passed from WAMP `SUBSCRIBE` messages.
- [ ] 3.2 Update `lib/mqtt/gate.ts` to support the `snapshot` option in subscription logic.

## 4. Testing and Verification

- [ ] 4.1 Create a new test file `test/71.snapshot_subscription.ts` to verify snapshot behavior.
- [ ] 4.2 Implement a test case for snapshot with retained data only.
- [ ] 4.3 Implement a test case for snapshot with history data only.
- [ ] 4.4 Implement a test case for snapshot with both retained and history data.
- [ ] 4.5 Implement a test case for snapshot with no data (immediate unsubscription).
- [ ] 4.6 Verify that live events are NOT delivered to snapshot subscribers during replay.
- [ ] 4.7 Verify that the Hyper API `subscribe` promise resolves correctly after snapshot unsubscription.

## 5. Documentation

- [ ] 5.1 Update root `README.md` to document the new `snapshot` option in the "Subscribe Options" section.
- [ ] 5.2 Update `openspec/apis/wamp.md` and `openspec/apis/hyper.md` with the `snapshot` attribute description.
