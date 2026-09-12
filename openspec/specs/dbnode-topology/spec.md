# Dbnode Topology Specification

## Purpose

Defines the `dbNodes` cluster-config contract that lets a masterfree deployment declare one or more dedicated KV-node instances and, per instance, which realm+URI-pattern combinations that instance is responsible for hosting persistent KV projections for.

## Requirements

### Requirement: dbNodes Configuration Accessors
The system SHALL expose `dbNodes` cluster configuration through the `Config` class, following the same shape and access pattern already used for `eventNodes`.

#### Scenario: Listing configured db nodes
- **WHEN** `Config.getDbNodes()` is called after loading a config file containing a `dbNodes` section
- **THEN** it SHALL return the raw `dbNodes` map keyed by node id (each entry carrying at least `host`, `port`, and `storage`).

#### Scenario: Missing dbNodes section
- **WHEN** `Config.getDbNodes()` is called on a config file with no `dbNodes` section
- **THEN** it SHALL return `undefined` rather than throwing.

#### Scenario: Looking up a single db node by id
- **WHEN** `Config.getDbNodeById(nodeId)` is called with an id present in `dbNodes`
- **THEN** it SHALL return that node's config entry.

#### Scenario: Listing storage patterns for a node
- **WHEN** `Config.findStoragePatternsForNode(nodeId)` is called for a node id present in `dbNodes` with a `storage` array
- **THEN** it SHALL return that array of raw `<realm>:<key-pattern>` strings unchanged.

#### Scenario: Storage patterns for an unknown or unset node
- **WHEN** `Config.findStoragePatternsForNode(nodeId)` is called for a node id absent from `dbNodes`, or when `dbNodes` itself is absent
- **THEN** it SHALL return an empty array rather than throwing.

### Requirement: Storage Pattern Grammar
Each string in a `dbNodes.<id>.storage` array SHALL be interpreted as `<realm>:<key-pattern>`, split on the first `:` character.

#### Scenario: Exact realm name
- **WHEN** a storage pattern's realm segment is a literal realm name (e.g. `myapp`)
- **THEN** the pattern SHALL match only that realm.

#### Scenario: Wildcard realm
- **WHEN** a storage pattern's realm segment is `*`
- **THEN** the pattern SHALL match any realm name.

#### Scenario: Key-pattern uses canonical dotted form
- **WHEN** a storage pattern's key-pattern segment is parsed
- **THEN** the system SHALL parse it as canonical dotted FOX topic text via the existing `defaultParse()` function, and match candidate URIs against it via the existing `match()` function from `lib/topic_pattern.ts` — the same functions already used to match a registered projection's `uri_pattern`.
- **AND** the system SHALL NOT introduce a second, independent pattern-matching implementation for this purpose.

### Requirement: Storage Pattern Validation
The system SHALL validate a node's configured storage patterns before the node is allowed to serve traffic, following the same fail-fast convention as `validateShardsForNode`.

#### Scenario: Rejecting a pattern with no realm separator
- **WHEN** `Config.validateStorageForNode(nodeId)` is called and one of the node's storage patterns contains no `:` character
- **THEN** it SHALL throw an error identifying the offending node id and pattern string.

#### Scenario: Rejecting a pattern with an empty realm or key segment
- **WHEN** `Config.validateStorageForNode(nodeId)` is called and a storage pattern's realm segment or key-pattern segment is empty
- **THEN** it SHALL throw an error identifying the offending node id and pattern string.

#### Scenario: Accepting well-formed patterns
- **WHEN** `Config.validateStorageForNode(nodeId)` is called and every one of the node's storage patterns has a non-empty realm segment (or `*`) and a non-empty, dotted-form key-pattern segment
- **THEN** it SHALL NOT throw.

### Requirement: Node-Level Storage Responsibility Gate
A KV-node instance SHALL only register persistent KV projection state (storage registry records and their linked schemas) for a realm+URL-pattern combination covered by at least one of its own configured storage patterns.

#### Scenario: Registration within a covered pattern
- **GIVEN** a KV-node instance configured with a storage pattern whose realm and key-pattern cover a given realm and `urlPattern`
- **WHEN** a request to register a KV projection for that realm and `urlPattern` is evaluated against this node's storage patterns
- **THEN** the combination SHALL be treated as covered, permitting registration to proceed.

#### Scenario: Registration outside every configured pattern
- **GIVEN** a KV-node instance whose storage patterns do not cover a given realm and `urlPattern` combination
- **WHEN** a request to register a KV projection for that realm and `urlPattern` is evaluated against this node's storage patterns
- **THEN** the combination SHALL be treated as not covered, and registration SHALL NOT proceed on this node.

### Requirement: Overlapping Storage Responsibility
Multiple `dbNodes` entries MAY declare storage patterns that overlap or are identical, including the fully-open `*:*` pattern on more than one node. The system SHALL treat overlapping ownership as valid configuration, not an error.

#### Scenario: Two nodes configured with identical wildcard patterns
- **GIVEN** two `dbNodes` entries each configured with `storage: ["*:*"]`
- **WHEN** both nodes are active in the cluster
- **THEN** each SHALL independently host and maintain its own persistent KV projections for every realm it observes.
- **AND** the system SHALL NOT require coordination, leader election, or mutual awareness between the two nodes to do so.

#### Scenario: Partially overlapping patterns
- **GIVEN** two `dbNodes` entries with storage patterns that cover an overlapping but not identical set of realm+key-pattern combinations
- **WHEN** both nodes are active in the cluster
- **THEN** each SHALL independently maintain projections only for the combinations its own patterns cover, with no requirement that the two node's projected data sets be reconciled with each other.

### Requirement: Downstream-Only Committed Event Consumption
A KV-node SHALL consume already-committed segment data as a downstream subscriber and SHALL NOT introduce a new event or topic type to receive it.

#### Scenario: Reusing the existing committed-segment broadcast
- **WHEN** a KV-node needs to observe newly committed segment events to advance its projections
- **THEN** it SHALL do so by connecting to entry nodes and subscribing to the existing `SEGMENT_COMMITTED` broadcast that storage nodes already publish into the sys realm and already pipe live-tail to attached entries.
- **AND** the system SHALL NOT define a second, KV-node-specific event or topic carrying the same committed-segment data.

#### Scenario: No participation in ID-election voting
- **WHEN** a KV-node instance is connected to the cluster
- **THEN** it SHALL NOT originate, forward, or vote on `GENERATE_DRAFT`, `PICK_CHALLENGER`, or `ELECT_SEGMENT` messages.
- **AND** it SHALL NOT hold any StageOne or StageTwo voting state.
