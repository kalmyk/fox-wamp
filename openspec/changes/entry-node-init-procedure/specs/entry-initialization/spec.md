### Requirement: Entry Node Handshake Protocol
The Entry node MUST initiate a handshake with all Sync nodes upon startup to synchronize its state before serving client requests.

#### Scenario: Successful Handshake Initiation
- **WHEN** the Entry node starts up
- **THEN** it SHALL send an `INIT_ENTRY` message containing its `nodeId` to all configured Sync nodes.
 - **IMPLEMENTATION NOTE:** The code subscribes to `INIT_ENTRY_ACCEPTED.<myNodeId>` then publishes `INIT_ENTRY`. The handshake is performed by NetEngineMill.initHandshake(syncQuorum, timeoutMs) which resolves with the computed `maxAdvanceId`. Startup now waits for the handshake to complete before starting servers.

### Requirement: Sync Node Response to Init
Sync nodes MUST respond to `INIT_ENTRY` requests to acknowledge the Entry node and provide synchronization context.

#### Scenario: Sync Node Acknowledgment
- **WHEN** a Sync node receives an `INIT_ENTRY` message
- **THEN** it SHALL respond with an `INIT_ENTRY_ACCEPTED` message to the node-specific topic (`INIT_ENTRY_ACCEPTED.<nodeId>`).
- **AND** the response SHALL include the Sync node's `lastSeenAdvanceId` for that requester.

### Requirement: Quorum-Based Entry Readiness
The Entry node MUST reach a quorum of Sync node responses before it is considered "ready".

#### Scenario: Reaching Quorum
- **WHEN** the Entry node receives `INIT_ENTRY_ACCEPTED` responses from at least `syncQuorum` unique Sync nodes
- **THEN** it SHALL compute the maximum `lastSeenAdvanceId` from all received responses.
- **AND** it SHALL transition to a "ready" state and proceed with starting its listener servers.

#### Scenario: Handshake Timeout
- **WHEN** the Entry node does not reach `syncQuorum` within the configured timeout (default 30s)
- **THEN** it SHALL abort the startup process (or handle as a failure) to prevent serving potentially inconsistent data.
