### Requirement: Entry Node Handshake Protocol (Passive)
The Entry node MUST wait for a synchronization handshake from Sync nodes upon startup to synchronize its state before serving client requests.

#### Scenario: Passive Handshake Initiation
- **WHEN** the Entry node starts up
- **THEN** it SHALL start its FOX server to listen for internal cluster connections.
- **AND** it SHALL subscribe to `INIT_ENTRY_ACCEPTED.<myNodeId>` to receive synchronization context from connecting nodes.
 - **IMPLEMENTATION NOTE:** The code waits in `NetEngineMill.initHandshake(syncQuorum, timeoutMs)` which resolves once quorum is met via passive `INIT_ENTRY_ACCEPTED` messages.

### Requirement: Cluster Node Handshake Initiation
Sync nodes MUST initiate a handshake upon connecting to an Entry node to provide synchronization context.

#### Scenario: Handshake Initiation on Connection
- **WHEN** a Sync node establishes a connection to an Entry node
- **THEN** it SHALL immediately send an `INIT_ENTRY_ACCEPTED` message to the Entry node's specific topic (`INIT_ENTRY_ACCEPTED.<entryId>`).
- **AND** the response SHALL include the sender's `lastSeenAdvanceId` for that Entry node.

### Requirement: Quorum-Based Entry Readiness
The Entry node MUST reach a quorum of synchronization responses before it is considered "ready".

#### Scenario: Reaching Quorum
- **WHEN** the Entry node receives `INIT_ENTRY_ACCEPTED` responses from at least `syncQuorum` unique nodes
- **THEN** it SHALL compute the maximum `lastSeenAdvanceId` from all received responses.
- **AND** it SHALL transition to a "ready" state and proceed with starting its client-facing (WAMP/MQTT) servers.

#### Scenario: Handshake Timeout
- **WHEN** the Entry node does not reach `syncQuorum` within the configured timeout (default 30s)
- **THEN** it SHALL log a failure and may proceed or abort depending on configuration, ensuring awareness of the inconsistent state.

