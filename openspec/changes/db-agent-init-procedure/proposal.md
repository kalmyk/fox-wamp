## Why

NDB (database) nodes must ensure they are fully synchronized with the cluster state before they begin serving queries. Currently, there is no formal initialization handshake that guarantees an NDB node has reached a consistent state relative to the Sync cluster. This change introduces a quorum-based initialization procedure to prevent serving stale or incomplete data.

## What Changes

- **Handshake Protocol**: Introduction of an `init-db` handshake between NDB nodes and the Sync cluster.
- **Node-ID Identification**: NDB nodes now identify themselves with a `node-id` during the initialization phase.
- **Sync Node Response**: Sync nodes will respond to a dedicated NDB queue with an "init accepted" status and their last seen `advance-id`.
- **Quorum-Based Activation**: NDB nodes will wait for a `syncQuorum` of responses before transitioning to a "ready" state and serving queries.
- **Max ID Tracking**: NDB nodes will collect and determine the maximum `advance-id` from the responses to establish their starting point.

## Capabilities

### New Capabilities
- `ndb-initialization`: Formal handshake and quorum logic for NDB storage nodes to reach a ready state.

### Modified Capabilities
- `distributed-mode`: Update the message lifecycle and synchronization protocol to include the NDB initialization phase.

## Impact

- `ndb.ts`: Implementation of the initialization state machine and message handling.
- `synchronizer.ts`: Logic to handle `init-db` requests and respond with the last seen `advance-id`.
- Communication protocols: Addition of the `init-db` and init response message types.
- Testing: New unit tests for the handshake and quorum logic.
