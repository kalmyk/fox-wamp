## Context

The current subscription model is designed for long-lived listeners. To get a one-time snapshot, clients must subscribe, wait for initial data, and then unsubscribe. This is inefficient and error-prone (e.g., forgetting to unsubscribe). A `snapshot` option simplifies this to a single operation.

## Goals / Non-Goals

**Goals:**
- Provide a `snapshot: true` option for subscriptions.
- Automatically terminate the subscription after initial data (retained state and/or history) is sent.
- Ensure the Hyper API `subscribe` promise resolves only after the snapshot is complete.
- Prevent delivery of live events to snapshot subscribers.

**Non-Goals:**
- Snapshot support for distributed/network mode (deferred until storage commit signals are ready).
- Changes to the underlying storage engines.

## Decisions

### 1. ActorTrace Property and Filtering
`ActorTrace` will be extended with a `snapshot: boolean` property. 
- **Filter Relaxation**: If `snapshot` is true, the strict `retained` filter in `ActorTrace.filter` will be bypassed (similar to `retainedState: true`). This ensures history events (which lack the `retained` flag) are delivered during the snapshot replay.
- **Live Suppression**: `ActorTrace.delayEvent` will be updated to immediately discard events if `snapshot` is true, preventing unnecessary buffering of live events during the replay phase.
- **Finality**: Once `traceStarted` is set to true (signaling replay completion), any further events will be rejected by the filter if `snapshot` is true.

### 2. Coordination in `BaseEngine.doTrace`
`doTrace` will be updated to wait for the completion of the replay chain.
- For local engines, `replayRetainedState` and `getHistoryAfter` return promises.
- The system will wait for history replay, then `waitForRetainedEventId` (if applicable), then `replayRetainedState`.
- A combined promise (e.g., `Promise.all` or a sequential chain) will be used to detect when all initial data has been dispatched.

### 3. Automatic Cleanup
When the replay coordination promise resolves and `snapshot` is true:
- The engine will terminate the trace internally using the actor's context and subscription ID.
- This cleans up router/session subscription state without processing an `UNSUBSCRIBE` command.
- Snapshot termination is a completion signal for the initiating subscribe operation, not a client-requested unsubscribe flow.

### 4. Hyper API and WAMP Promise Management
- **Hyper API**: `HyperClient.subscribe` will resolve its promise after the initial data has been dispatched and snapshot termination has completed. The `snapshot` flag will be used to keep the original subscribe promise pending through the initial `SUBSCRIBED` acknowledgment and resolve it from the internal snapshot completion path.
- **WAMP**: Standard behavior applies; the `SUBSCRIBED` acknowledgment is sent as usual, and internal snapshot termination follows the data replay.
- **Timing**: Server-side snapshot termination ensures that even if a client doesn't manually close the snapshot, resources are released.

### 5. MQTT Gateway Support
The MQTT gate will be updated to recognize the `snapshot: true` flag. Since MQTT already uses `retainedState: true` internally, the `snapshot` flag will complement this by adding the automatic unsubscription behavior.

## Risks / Trade-offs

- **[Risk] Promise Leakage**: If the router fails to emit the internal snapshot completion signal, the Hyper API promise might hang.
  - **Mitigation**: The automatic cleanup in `doTrace` is reliable for local engines. We can add a timeout to the `subscribe` call if needed, but existing session/engine cleanups also handle this.
- **[Trade-off] Short-lived subscription state**: Snapshot subscribers receive `SUBSCRIBED`, then the server terminates the subscription internally after replay.
  - **Mitigation**: This keeps protocol setup behavior normal while ensuring gates can clear the short-lived subscription.
