# Distributed Mode (Masterfree)

## Overview
The "Masterfree" mode provides a distributed, high-availability architecture for message routing. It eliminates single points of failure by synchronizing state across multiple nodes using a multi-stage consensus process.

## Architecture Components
- **Entry Nodes (`entry.ts`):** Handle client connections (WAMP/MQTT) and initiate the message lifecycle by generating temporary "advance-ids".
- **NDB Storage Nodes (`ndb.ts`):** Manage persistent storage in SQLite and participate in the segment termination and ID election process.
- **Sync Cluster (`synchronizer.ts`):** Responsible for transforming temporary advance-ids into monotonic, permanent IDs across the cluster.

## Message Lifecycle & Flow
The system uses a unique ID generation and synchronization process to ensure consistency and ordering across distributed nodes.

### ID Structure
`DateTime + Segment + Offset + [ Shard * ProcessingStep ]`
- **advanceId {segment, offset}**: 
    - `segment`: A nearly random string value.
    - `offset`: Offset inside the segment.

### Sequence Diagram
```text
    entry                        ndb                          stage one                         stage two

  --->  BEGIN_ADVANCE_SEGMENT ->

  --->  KEEP_ADVANCE_HISTORY  ->

        <- TRIM_ADVANCE_SEGMENT * each ndb
        [vote to take network lag for segment]

  --->  ADVANCE_SEGMENT_OVER ->

  -------------------------------------->   GENERATE_DRAFT -> generate mew time+genId for tmp-id
                                                        send to next sync stage
                                                        
                                                    +---- VOTE
                                                    |        take low _in_vouter_ time+genId
                                                    |        for tmp-id send to final
                                                    |        sync stage
                                                    +->  PICK_CHALLENGER # SyncID ->
                                                        challenger id is generated

                                                        <-> VOTE <->
                                                            two sync units generates draft id,
                                                            pair of lower is elected

                                                    ELECT_SEGMENT ->

                                                                                                VOTE MAX / StageTwoTask
                                                                                                

    -> ADVANCE_SEGMENT_RESOLVED
```

### Detailed Flow
1. **Entry Initialization:** When a message arrives, a unique `advance-id` is created. Partitioning is handled via round-robin. The message and subsequent ones are signed with the `advance-id` and a sequence number.
2. **Segment Announcement:** `BEGIN_ADVANCE_SEGMENT` is sent to all sync hosts and NDB storages.
3. **Data Replication:** Message bodies are replicated to storage hosts via `KEEP_ADVANCE_HISTORY`.
4. **Segment Termination:** 
    - NDB nodes respond with `TRIM_ADVANCE_SEGMENT` to signal readiness to terminate the segment.
    - Once elected, `ADVANCE_SEGMENT_OVER` is sent.
5. **ID Election (Sync Cluster):**
    - `GENERATE_DRAFT`: Generates a draft permanent ID based on time and generator ID.
    - `VOTE`: Sync stages coordinate to pick the lower ID.
    - `PICK_CHALLENGER`: A challenger ID is generated and voted upon.
    - `ELECT_SEGMENT`: Final consensus on the permanent ID.
6. **Resolution:** `ADVANCE_SEGMENT_RESOLVED` is sent back to entry and NDB nodes. Temporary storage is then moved to permanent storage, and ACK is sent to the client.

## Synchronization Protocol & Communication
Uses internal `HyperNet` protocol for low-latency node-to-node communication and voting.

### Node Communication Architecture
To facilitate robust development and simplify local testing, the communication between nodes adheres to the following principles:
- **Local Queue-Based Messaging:** All inter-node communication is abstracted through local queues. This allows the system to simulate complex network topologies on a single machine without requiring actual network overhead or external infrastructure.
- **Message Copying:** Instead of sharing memory or using pointers across node boundaries, messages are explicitly copied when moved from the source queue to the destination node's processing queue. This ensures total isolation between nodes and prevents race conditions.
- **Testability:** This architecture allows developers to "wire up" an entire distributed cluster locally by simply interconnecting these local queues in memory, enabling exhaustive testing of consensus and synchronization logic in a deterministic environment.
