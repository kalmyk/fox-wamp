## ADDED Requirements

### Requirement: KV-Node as a Fourth Node Type
The masterfree architecture SHALL recognize a KV-node as a fourth process/node type, alongside Entry Nodes, the Sync Cluster, and NDB Storage Nodes, responsible for hosting persistent KV projections (`StorageRegistry`, `SchemaRepository`, generated projection tables) as declared by the `dbNodes` cluster config section.

#### Scenario: KV-node identified in architecture
- **WHEN** the masterfree architecture is described
- **THEN** the KV-node SHALL be listed as a distinct component from NDB Storage Nodes, driven by its own `dbNodes` cluster-config section (host/port/`storage` patterns), separate from the `eventNodes` section that configures NDB storage/shard ownership.

### Requirement: KV-Node Position in the Message Lifecycle
A KV-node SHALL sit strictly downstream of segment commitment in the message lifecycle and SHALL take no part in the ID-election (StageOne/StageTwo) handshake described in the Sequence Diagram.

#### Scenario: KV-node ingestion point
- **WHEN** a segment is committed by a storage node and `SEGMENT_COMMITTED` is emitted
- **THEN** any KV-node whose configured storage patterns match the committed events' realm and URI SHALL observe those events by subscribing to the existing `SEGMENT_COMMITTED` broadcast already delivered to attached entry nodes.
- **AND** this observation SHALL occur after `ADVANCE_SEGMENT_RESOLVED`, using only already-committed, already-ordered event data.

#### Scenario: KV-node excluded from stateless voting invariants table
- **WHEN** the stateless voting invariants (no heap accumulation, monotonic IDs, stale entry cleanup) are evaluated for cluster correctness
- **THEN** they SHALL apply only to Entry, Sync (StageOne), and NDB Storage (StageTwo) nodes.
- **AND** a KV-node's per-realm projection state SHALL be bounded by the realms actually matched by that node's own `dbNodes.storage` patterns, not by advance-id or segment volume.
