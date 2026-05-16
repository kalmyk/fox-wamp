## Context

The current subscription model is designed for long-lived listeners. To get a one-time snapshot, clients must subscribe, wait for initial data, and then unsubscribe. This is inefficient and error-prone (e.g., forgetting to unsubscribe). A `snapshot` option simplifies this to a single operation.

## Goals / Non-Goals

**Goals:**
- Provide a `snapshot: true` option for subscriptions.
- Automatically unsubscribe after initial data (retained state and/or history) is sent.
- Ensure the Hyper API `subscribe` promise resolves only after the snapshot is complete.
- Prevent delivery of live events to snapshot subscribers.

**Non-Goals:**
- Snapshot support for distributed/network mode (deferred until storage commit signals are ready).
- Changes to the underlying storage engines.

## Decisions

### 1. `ActorTrace` Property
`ActorTrace` will be extended with a `snapshot: boolean` property, initialized from the subscription options.

### 2. Coordination in `BaseEngine.doTrace`
`doTrace` will be updated to wait for both history replay and retained state replay to complete if they are requested.
- For local engines, `replayRetainedState` and `getHistoryAfter` both return promises.
- A combined promise (e.g., `Promise.all`) will be used to detect when all initial data has been dispatched.

### 3. Automatic Cleanup
When the replay coordination promise resolves and `snapshot` is true:
- The engine will call `realm.cmdUnTrace` using the actor's context and subscription ID.
- This ensures the router state is cleaned up and an `UNSUBSCRIBED` message is sent back to the gate/client.

### 4. Hyper API Promise Management
The Hyper API needs to distinguish between a normal subscription (resolve on `SUBSCRIBED`) and a snapshot (resolve on `UNSUBSCRIBED`).
- `HyperClient.subscribe` will include the `snapshot` flag in the `id` container passed to `cmdTrace`.
- `HyperApiContext.sendSubscribed` will be updated: if `snapshot` is true, it will store the subscription ID but NOT resolve the promise.
- `HyperApiContext.sendUnsubscribed` will be updated: if the `id` container has a pending snapshot promise, it will resolve it now.
- **Timing Guarantee**: The implementation MUST ensure that all `REQUEST_EVENT` messages containing snapshot data (retained/history) are processed and their callbacks executed BEFORE the `RESULT_OK` (UNSUBSCRIBED) message triggers the promise resolution. This ensures the client has received all data when the `subscribe` call completes.

### 5. Suppressing Live Events
To prevent live events from being delivered to a snapshot subscription:
- `ActorTrace.filter` will be updated to return `false` if `snapshot` is true and the event is not marked as `retained` or coming from history replay.
- Alternatively, since `snapshot` subscriptions will never set `traceStarted` to true (or will be unsubscribed before live events are flushed), they are naturally protected. We will explicitly ensure they don't receive live events by checking the `snapshot` flag in `disperseToSubs`.

### 6. MQTT Gateway Support
The MQTT gate will be updated to recognize the `snapshot: true` flag in its internal subscription logic. This allows MQTT clients (via future protocol extensions or internal API usage) to perform snapshot-only subscriptions using the same attribute name as WAMP and the Hyper API.

## Risks / Trade-offs

- **[Risk] Promise Leakage**: If the router fails to send an `UNSUBSCRIBED` message for a snapshot, the Hyper API promise might hang.
  - **Mitigation**: The automatic cleanup in `doTrace` is reliable for local engines. We can add a timeout to the `subscribe` call if needed, but existing session/engine cleanups also handle this.
- **[Trade-off] Multi-stage resolution**: Snapshot subscribers receive `SUBSCRIBED` then `UNSUBSCRIBED`.
  - **Mitigation**: This is consistent with the protocol and ensures gates correctly track the short-lived subscription.
