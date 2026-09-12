## Purpose

Defines the runtime behavior of a standalone masterfree KV-node process: its dual admin-gate/committed-segment-subscriber roles, multi-entry failover safety, on-demand realm bootstrap, and registration-time responsibility gating.

## ADDED Requirements

### Requirement: KV-Node Dual Role
A KV-node process SHALL operate two independent roles concurrently: an inbound admin gate reachable by administrative clients, and an outbound subscriber to committed segment data.

#### Scenario: Admin gate reachable independently of entry nodes
- **WHEN** an administrative client connects to a KV-node's configured `dbNodes.<id>.host`/`port`
- **THEN** the KV-node SHALL accept the connection and serve realm login and admin RPCs directly, without requiring any entry node to relay or proxy the request.

#### Scenario: Committed-segment subscription independent of admin traffic
- **WHEN** a KV-node has no admin clients connected
- **THEN** it SHALL still maintain its outbound subscription(s) to entry nodes and continue advancing its persistent KV projections as segments are committed.

### Requirement: Wire-Sourced Committed Segment Consumption
A KV-node SHALL derive its view of committed segment data exclusively from the committed-segment broadcast delivered over its outbound connections to entry nodes, never from a storage node's local in-process event source.

#### Scenario: Complete view across shards
- **GIVEN** a realm's traffic is distributed across shards owned by more than one storage node
- **WHEN** a KV-node processes committed segments for that realm
- **THEN** it SHALL observe committed events from every shard touched by that realm's traffic, not only shards owned by any single storage node.

### Requirement: Active/Standby Multi-Entry Failover
When a KV-node maintains outbound connections to more than one entry node for availability, exactly one such connection SHALL drive projection updates at any given time.

#### Scenario: Single active source under normal operation
- **GIVEN** a KV-node is connected to two or more entry nodes
- **WHEN** committed segment events arrive on more than one connection
- **THEN** the KV-node SHALL apply projection updates from exactly one designated active connection.
- **AND** it SHALL NOT apply projection updates concurrently sourced from more than one connection.

#### Scenario: Failover on active connection loss
- **GIVEN** a KV-node's active entry connection becomes unavailable
- **WHEN** a standby connection is available
- **THEN** the KV-node SHALL promote a standby connection to active.
- **AND** it SHALL resume applying projection updates only from the newly active connection.

#### Scenario: No regression from standby redelivery
- **GIVEN** a KV-node has already applied a committed segment through its active connection
- **WHEN** a standby connection later delivers the same or an earlier already-applied segment
- **THEN** the KV-node SHALL NOT apply projection updates from that standby delivery while it remains standby.

### Requirement: On-Demand Realm Bootstrap
A KV-node SHALL construct the admin surface for a given realm only when a client first interacts with that realm on the KV-node's own admin gate, without requiring a prior cluster-wide "realm created" announcement.

#### Scenario: First admin interaction bootstraps the realm
- **WHEN** an administrative client logs into a realm on a KV-node's admin gate for a realm the KV-node has not previously served
- **THEN** the KV-node SHALL construct that realm's persistent KV admin surface (storage registry, schema repository, admin RPCs) on demand before serving the request.

#### Scenario: Subsequent interactions reuse the bootstrapped realm
- **WHEN** a second administrative client logs into a realm already bootstrapped on a KV-node
- **THEN** the KV-node SHALL reuse the existing admin surface rather than reconstructing it.

### Requirement: Registration-Time Node Ownership Gate
A KV-node SHALL reject a `KV_ADD` or `SCHEMA_ADD` request whose target realm and URL pattern are not covered by that node's own configured storage patterns.

#### Scenario: Registration rejected outside node's coverage
- **GIVEN** a KV-node's configured storage patterns do not cover a given realm and URL pattern
- **WHEN** a `KV_ADD` or `SCHEMA_ADD` request targets that realm and URL pattern on this node
- **THEN** the KV-node SHALL reject the request with an error identifying the uncovered combination.

### Requirement: Wildcard First-Registration Precedence
A KV-node whose only coverage of a realm comes from a wildcard (`*`) realm storage pattern SHALL defer to a node with an explicit, exact-realm storage pattern for that realm's first-ever registration, when such a node is declared in the cluster configuration.

#### Scenario: Exact-realm node exists elsewhere in config
- **GIVEN** a realm has no existing registered projections anywhere yet
- **AND** the cluster configuration declares another KV-node with an exact (non-wildcard) realm pattern covering that realm
- **WHEN** a `KV_ADD` or `SCHEMA_ADD` request for that realm arrives at a KV-node that covers it only via a wildcard realm pattern
- **THEN** the KV-node SHALL reject the request, identifying the node id configured with the exact-realm pattern as the expected registration target.

#### Scenario: No exact-realm node declared anywhere
- **GIVEN** a realm has no existing registered projections anywhere yet
- **AND** no KV-node in the cluster configuration declares an exact (non-wildcard) realm pattern covering that realm
- **WHEN** a `KV_ADD` or `SCHEMA_ADD` request for that realm arrives at a KV-node that covers it via a wildcard realm pattern
- **THEN** the KV-node SHALL accept the request.

#### Scenario: Realm already has a registration
- **GIVEN** a realm already has at least one registered projection on this node
- **WHEN** a further `KV_ADD` or `SCHEMA_ADD` request for that realm arrives at this node
- **THEN** the wildcard first-registration precedence check SHALL NOT apply, and the request SHALL be evaluated only against the ordinary node ownership gate.

### Requirement: Wire-Sourced Activation Catch-Up
A KV-node SHALL catch up a projection's history — on first activation and after closing a connection outage — by pulling committed events from storage nodes over the network, since it maintains no local raw event history table.

#### Scenario: First activation backfills existing realm history
- **GIVEN** a realm already has committed history predating a projection's registration on a KV-node
- **WHEN** that projection is activated
- **THEN** the KV-node SHALL fetch and apply matching historical events for that realm from storage nodes before marking the projection online.
- **AND** the KV-node SHALL NOT treat the realm as having no prior history solely because its own local database has none.

#### Scenario: Projection remains non-live during catch-up
- **GIVEN** a KV-node is performing catch-up for a projection
- **WHEN** a `SEGMENT_COMMITTED` broadcast arrives on the KV-node's active connection during that catch-up
- **THEN** the KV-node SHALL NOT apply that broadcast's events to the projection currently undergoing catch-up until catch-up completes and the projection is marked online.

#### Scenario: Catch-up terminates
- **GIVEN** a KV-node has begun catch-up for a projection
- **WHEN** every shard's history has been fetched as of the time catch-up began
- **THEN** the KV-node SHALL mark the projection online and resume applying only live `SEGMENT_COMMITTED` broadcasts for it thereafter.

### Requirement: Bounded Cross-Shard Ordering Guard
Until cross-shard `eventId` ordering is corrected at its source, a KV-node SHALL protect its projections' position watermarks from regression using only per-realm, heap-bounded state.

#### Scenario: Out-of-order delivery is dropped, not buffered
- **GIVEN** a KV-node has already applied a committed event for a realm with a given `eventId`
- **WHEN** a subsequently delivered committed event for the same realm carries an `eventId` that does not exceed the already-applied one
- **THEN** the KV-node SHALL discard that event's projection updates for this delivery rather than queueing it for reordering.

#### Scenario: Guard state stays bounded by realm count
- **WHEN** a KV-node has been running for an extended period, regardless of total event volume
- **THEN** the ordering guard's retained state SHALL remain bounded by the number of distinct realms observed, not by the number of events or advance-ids processed.

### Requirement: KV Node Discovery
The system SHALL provide an admin RPC that lists every configured KV-node and its storage patterns, served directly by any running KV-node's own admin gate.

#### Scenario: Listing configured KV-nodes
- **WHEN** an administrative client calls the KV-node-list RPC against any running KV-node
- **THEN** the response SHALL include, for every `dbNodes` entry in the cluster configuration, its node id, host, port, and each of its storage patterns.

### Requirement: No Participation in ID-Election Voting
A KV-node process SHALL take no part in the StageOne/StageTwo ID-election handshake, regardless of its dual-role connections to entry nodes.

#### Scenario: KV-node ignores election traffic
- **WHEN** a KV-node's outbound connection to an entry node is active
- **THEN** the KV-node SHALL NOT originate, forward, or vote on `GENERATE_DRAFT`, `PICK_CHALLENGER`, or `ELECT_SEGMENT` messages, and SHALL hold no StageOne or StageTwo voting state.
