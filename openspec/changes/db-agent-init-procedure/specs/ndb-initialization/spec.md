## ADDED Requirements

### Requirement: NDB Initialization Handshake
The NDB agent MUST initiate a handshake with all Sync nodes upon startup to synchronize its state before serving queries.

#### Scenario: Successful Handshake Initiation
- **WHEN** the NDB agent starts up
- **THEN** it SHALL send an `init-db` message containing its `node-id` to all configured Sync nodes.

### Requirement: Sync Node Response to Init
Sync nodes MUST respond to `init-db` requests to acknowledge the NDB node and provide synchronization context.

#### Scenario: Sync Node Acknowledgment
- **WHEN** a Sync node receives an `init-db` message
- **THEN** it SHALL respond to the dedicated NDB response queue with an "init accepted" status and its currently tracked `last seen advance-id`.

### Requirement: NDB Quorum Collection
The NDB agent MUST collect responses from Sync nodes and wait for a quorum before becoming ready.

#### Scenario: Reaching Sync Quorum
- **WHEN** the NDB agent receives "init accepted" messages from a number of Sync nodes equal to or greater than `syncQuorum`
- **THEN** it SHALL transition to a "ready" state and begin serving queries.

### Requirement: Advance-ID Synchronization
The NDB agent MUST determine the correct starting `advance-id` from the Sync node responses.

#### Scenario: Determining Max Advance-ID
- **WHEN** the NDB agent reaches `syncQuorum`
- **THEN** it SHALL identify the maximum `advance-id` received across all "init accepted" responses to establish its baseline cluster state.
