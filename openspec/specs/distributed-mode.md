# Distributed Mode (Masterfree)

## Overview
The "Masterfree" mode provides a distributed, high-availability architecture for message routing. It eliminates single points of failure by synchronizing state across multiple nodes using a multi-stage consensus process.

## Architecture Components
- **Entry Nodes (`entry.ts`):** Handle client connections (WAMP/MQTT) and initiate the message lifecycle by generating temporary "advance-ids".
- **NDB Storage Nodes (`ndb.ts`):** Manage persistent storage in SQLite and participate in the segment termination and ID election process.
- **Sync Cluster (`synchronizer.ts`):** Responsible for transforming temporary advance-ids into monotonic, permanent IDs across the cluster via two-stage stateless voting.

## Message Lifecycle & Flow
The system uses a unique ID generation and synchronization process to ensure consistency and ordering across distributed nodes.

### ID Structure
`DateTime + Segment + Offset + [ Shard * ProcessingStep ]`
- **advanceId {segment, offset}**:
    - `segment`: A numeric value (timestamp in msec).
    - `offset`: Offset inside the segment.

---

## Sequence Diagram

```text
  entry                    StageOne (sync)              StageTwo (db-node)
    │                            │                            │
    │  BEGIN_ADVANCE_SEGMENT ───>│                            │
    │                            │                            │
    │  ADVANCE_SEGMENT_OVER ────>│                            │
    │                            │                            │
    │      GENERATE_DRAFT ──────>│                            │
    │                            │  generate draft-id         │
    │                            │  (one per advanceId)       │
    │                            │                            │
    │                   PICK_CHALLENGER ──────────────────>   │
    │                     (to each peer StageOne)             │
    │                            │<── PICK_CHALLENGER ────────│
    │                            │  (peers send their draft   │
    │                            │   for this advanceId)      │
    │                            │                            │
    │                            │  [collect per advanceId]   │
    │                            │  min(draftIds) at quorum   │
    │                            │  → discard voting state    │
    │                            │                            │
    │                            │── ELECT_SEGMENT ──────────>│
    │                            │  (challenger = min draft)  │
    │                            │                            │
    │                            │<── ELECT_SEGMENT ──────────│
    │                            │  (each StageOne sends its  │
    │                            │   minimum to StageTwo)     │
    │                            │                            │
    │                            │    [collect per advanceId] │
    │                            │    max(challengers) at quorum
    │                            │    → discard voting state  │
    │                            │                            │
    │<──────────────────────────────── ADVANCE_SEGMENT_RESOLVED
    │  (segment = max of mins)   │                            │
    │                            │                            │
    │  [move advance → permanent]│                            │
    │  [send ACK to client]      │                            │
```

**Error path (quorum timeout):**

```text
  entry                                                      StageTwo
    │                                                           │
    │                                              [no quorum after 30s]
    │<──────────────────────────── ADVANCE_SEGMENT_FAILED ──────│
    │  (reason: timeout)                                        │
    │                                                           │
    │  [entry retries with new advance segment]                 │
```

---

## Detailed Flow

### 1. Entry Initialization
When a message arrives, a unique `advance-id` is created. Partitioning is handled via round-robin. The message and subsequent ones are signed with the `advance-id` and a sequence number.

### 2. Segment Announcement
`BEGIN_ADVANCE_SEGMENT` is sent to all sync hosts and NDB storages.

### 3. Data Replication
Message bodies are replicated to storage hosts via `KEEP_ADVANCE_HISTORY`.

### 4. Segment Termination
NDB nodes respond with `TRIM_ADVANCE_SEGMENT` to signal readiness to terminate the segment. Once elected, `ADVANCE_SEGMENT_OVER` is sent.

### 5. ID Election — StageOne (Draft Generation & Minimum Selection)

Each StageOne node (sync node) runs `StageOneTask`:

1. On `GENERATE_DRAFT`: generates a unique draft ID (timestamp + monotonic counter). Each `advanceId` generates at most one draft per node. Advances `recentAdvanceSegment` for this entry owner; any stale voting entry for the previous segment is deleted.
2. Broadcasts the draft as `PICK_CHALLENGER` to all peer StageOne nodes.
3. On `PICK_CHALLENGER` from a peer: checks that `advanceStamp >= recentAdvanceSegment[advanceOwner]`; if not, the segment is already resolved — skip. Otherwise records the peer's draft.
4. Once votes from `syncQuorum` nodes are collected for an `advanceId`:
   - Selects the **minimum** draft ID across all voters.
   - Publishes `ELECT_SEGMENT` with this minimum as `challenger`.
   - **Discards all voting state** for this `advanceId` immediately.

**Memory bound:** At most one in-flight voting entry per active `advanceId`. Completed entries are evicted immediately; stale (quorum-missed) entries are evicted when the entry owner advances to the next segment — guaranteed once the previous segment resolves.

### 6. ID Election — StageTwo (Maximum Selection)

Each StageTwo node (typically co-located on db-node) runs `StageTwoTask`:

1. On `ELECT_SEGMENT` from a StageOne node: records the challenger for this `advanceId`.
2. Monotonic guard: if `challenger < recentValue`, skip (prevents out-of-order ID regression).
3. Once votes from `syncQuorum` StageOne nodes are collected:
   - Selects the **maximum** challenger across all voters.
   - Publishes `ADVANCE_SEGMENT_RESOLVED` with `segment = max(challengers)`.
   - Updates `recentValue` to the resolved ID (monotonic invariant).
   - **Discards all voting state** for this `advanceId` immediately.
4. Lazy eviction: if the voting entry has waited beyond `timeoutMs` without quorum, it is discarded on the next incoming vote and `ADVANCE_SEGMENT_FAILED` is published so the entry node can retry.

### 7. Resolution
`ADVANCE_SEGMENT_RESOLVED` is sent back to entry and NDB nodes. Temporary advance storage is moved to permanent storage, and ACK is sent to the client.

---

## Stateless Voting Invariants

| Property | Guarantee |
|----------|-----------|
| **No heap accumulation** | Each stage keeps at most one entry per active `advanceId`; evicted immediately on quorum |
| **Stale entry cleanup (StageOne)** | When entry advances to segment N+1, the voting entry for segment N is deleted — guaranteed once N resolves |
| **Stale entry cleanup (StageTwo)** | Voting entries are lazily evicted on the next incoming vote if `timeoutMs` has elapsed |
| **Late vote guard (StageOne)** | `recentAdvanceSegment[owner] > advanceStamp` → segment already resolved → skip |
| **Monotonic IDs** | `recentValue` in StageTwo ensures `finalId` is non-decreasing across segments |
| **Deduplication** | `voters: Set<nodeId>` — duplicate votes from the same node are ignored |

---

## Timeout Configuration

| Parameter | Stage | Default | Meaning |
|-----------|-------|---------|---------|
| `timeoutMs` | StageTwo | 30 000 ms | Max age of a voting entry before lazy eviction triggers `ADVANCE_SEGMENT_FAILED` |

`StageTwoTask` accepts an optional `options.timeoutMs` constructor argument to override the default. `StageOneTask` has no timeout — stale entries are cleaned up by the monotonic `recentAdvanceSegment` advance.

---

## Synchronization Protocol & Communication
Uses internal `HyperNet` protocol for low-latency node-to-node communication and voting.

### Node Communication Architecture
- **Local Queue-Based Messaging:** All inter-node communication is abstracted through local queues. This allows the system to simulate complex network topologies on a single machine without requiring actual network overhead or external infrastructure.
- **Message Copying:** Instead of sharing memory or using pointers across node boundaries, messages are explicitly copied when moved from the source queue to the destination node's processing queue. This ensures total isolation between nodes and prevents race conditions.
- **Testability:** This architecture allows developers to wire up an entire distributed cluster locally by simply interconnecting these local queues in memory, enabling exhaustive testing of consensus and synchronization logic in a deterministic environment.

---

## Requirements

### Requirement: Distributed retained event synchronization
In distributed mode, synchronization for `after` SHALL wait for the local Key-Value projection watermark to reach the requested event ID before retained state is fetched.

#### Scenario: Distributed sync wait
- **WHEN** a subscription is made on an entry node with `retained: true` and `after: "REMOTE_EVENT_999"`
- **AND** distributed retained synchronization is implemented
- **THEN** the node SHALL wait until its local Key-Value projection `kv_storage_${realmName}.current_position` has reached at least `"REMOTE_EVENT_999"`.
- **AND** the node SHALL fetch and send retained rows from that same local Key-Value projection.
- **AND** the subscription SHALL remain active and deliver matching live events during this wait.

#### Scenario: Distributed sync remains gated before projection support
- **WHEN** a subscription is made on an entry node with `retained: true` and `after: "REMOTE_EVENT_999"`
- **AND** the node cannot observe a local Key-Value projection watermark for retained lookup
- **THEN** the node SHALL reject the synchronized retained replay request as unsupported.
