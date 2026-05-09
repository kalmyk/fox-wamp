## Why

NDB (database) nodes must ensure they are fully synchronized with the cluster state before they begin serving queries. Currently, there is no formal initialization handshake that guarantees an NDB node has reached a consistent state relative to the Sync cluster. This change introduces a quorum-based initialization procedure to prevent serving stale or incomplete data.

## What Changes

- **Handshake Protocol**: Introduction of an `init-db` handshake between NDB nodes and the Sync cluster.
- **Node-ID Identification**: NDB nodes now identify themselves with a `node-id` during the initialization phase.
- **Sync Node Response**: Sync nodes will respond to a dedicated NDB queue with an "init accepted" status and their last seen `advance-id`.
- **Quorum-Based Activation**: NDB nodes will wait for a `syncQuorum` of responses before transitioning to a "ready" state and serving queries.
- **Max ID Tracking**: NDB nodes will collect and determine the maximum `advance-id` from the responses to establish their starting point.
  - **Implementation Notes**: This change was implemented. New events `INIT_DB` and `INIT_DB_ACCEPTED` were added to `lib/masterfree/hyper.h.ts`. The sync response uses StageOneTask.getRecentValue() as the `lastSeenAdvanceId`. The handshake code is implemented in `lib/masterfree/storage.ts` as `StorageTask.initHandshake` and the sync handler in `lib/masterfree/synchronizer.ts` as `StageOneTask.event_init_db`. The storage process now waits for quorum before attaching entry (gate) listeners (masterfree/ndb.ts). A default handshake timeout of 30000ms (30s) is applied; failures currently abort startup (process exit) to avoid exposing storage before readiness.

## Capabilities

### New Capabilities
- `ndb-initialization`: Formal handshake and quorum logic for NDB storage nodes to reach a ready state.

### Modified Capabilities
- `distributed-mode`: Update the message lifecycle and synchronization protocol to include the NDB initialization phase.

## Impact

- `ndb.ts`: Now waits for the handshake to complete before attaching gate listeners (masterfree/ndb.ts).
- `synchronizer.ts`: Responds with the lastSeenAdvanceId (StageOneTask.getRecentValue()).
- Tests: test/63.storage.ts added to verify handshake quorum and maxAdvanceId calculation.
