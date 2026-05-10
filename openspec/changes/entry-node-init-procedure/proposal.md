## Why

Entry nodes must ensure they are fully synchronized with the cluster state before they begin serving queries. Currently, there is no formal initialization handshake that guarantees an entry node has reached a consistent state relative to the Sync cluster. This change introduces a quorum-based initialization procedure to prevent serving stale or incomplete data and to ensure correct message sharding/sequencing.

## What Changes

- **Handshake Protocol**: Introduction of an `init-entry` handshake between entry nodes and the Sync cluster.
- **Node-ID Identification**: Entry nodes now identify themselves with a `node-id` during the initialization phase.
- **Sync Node Response**: Sync nodes will respond to a dedicated entry queue with an "init accepted" status and their last seen `advance-id`.
- **Quorum-Based Activation**: Entry nodes will wait for a `syncQuorum` of responses before transitioning to a "ready" state and serving client requests.
- **Max ID Tracking**: Entry nodes will collect and determine the maximum `advance-id` from the responses to establish their starting point.
  - **Implementation Notes**: This change was implemented. New events `INIT_ENTRY` and `INIT_ENTRY_ACCEPTED` were added to `lib/masterfree/hyper.h.ts`. The sync response uses StageOneTask.getRecentValue() as the `lastSeenAdvanceId`. The handshake code is implemented in `lib/masterfree/netengine.ts` as `NetEngineMill.initHandshake` and the sync handler in `lib/masterfree/synchronizer.ts` as `StageOneTask.event_init_entry`. The entry process now waits for quorum before starting WAMP/MQTT/FOX servers (masterfree/entry.ts). A default handshake timeout of 30000ms (30s) is applied.

## Capabilities

### New Capabilities
- `entry-initialization`: Formal handshake and quorum logic for entry nodes to reach a ready state.

### Modified Capabilities
- `distributed-mode`: Update the message lifecycle and synchronization protocol to include the entry initialization phase.

## Impact

- `entry.ts`: Now waits for the handshake to complete before starting servers.
- `synchronizer.ts`: Responds with the lastSeenAdvanceId (StageOneTask.getRecentValue()).
- `netengine.ts`: Implements `initHandshake` and `listenSync` for entry nodes.
- Tests: test/64.net_init.ts added to verify handshake quorum and maxAdvanceId calculation for entry nodes.
