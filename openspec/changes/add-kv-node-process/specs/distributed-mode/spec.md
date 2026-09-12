## ADDED Requirements

### Requirement: KV-Node Process Topology
A KV-node process SHALL be reachable by administrative clients independently of the entry/sync/storage node topology, via its own configured `dbNodes` host and port, while consuming committed segment data purely as a downstream subscriber.

#### Scenario: KV-node has an independent admin address
- **WHEN** the masterfree architecture's node topology is described
- **THEN** a KV-node's admin-reachable address SHALL be its own `dbNodes.<id>.host`/`port`, distinct from any entry, sync, or NDB storage node's address.

#### Scenario: KV-node's outbound role does not grant it inbound election standing
- **WHEN** a KV-node connects outward to an entry node to subscribe to `SEGMENT_COMMITTED`
- **THEN** that connection SHALL NOT be treated as an entry, sync, or storage node identity for the purposes of `BEGIN_ADVANCE_SEGMENT`, `GENERATE_DRAFT`, `PICK_CHALLENGER`, or `ELECT_SEGMENT` routing.

### Requirement: KV-Node Realm Admin Surface Availability
Persistent KV projection admin operations (`KV_ADD`, `KV_ACTIVATE`, `KV_RESET`, `KV_LIST`, `SCHEMA_ADD`, `SCHEMA_LIST`, `SCHEMA_DROP`) SHALL be reachable in masterfree deployments through a running KV-node process, since neither entry nodes nor NDB storage nodes expose this admin surface.

#### Scenario: Admin surface absent without a KV-node
- **WHEN** a masterfree deployment runs entry, sync, and NDB storage nodes but no KV-node
- **THEN** persistent KV projection admin operations SHALL NOT be reachable anywhere in the cluster.

#### Scenario: Admin surface present once a KV-node runs
- **WHEN** a masterfree deployment adds a running KV-node process
- **THEN** persistent KV projection admin operations for the realms that KV-node's storage patterns cover SHALL become reachable at that KV-node's own address.
