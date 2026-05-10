## MODIFIED Requirements

### Requirement: Entry Initialization with Shard Allocation
When a message arrives, a unique `advance-id` is created. Shard allocation is handled via deterministic round-robin across 2^20 (1048576) shards at the entry node. Each incoming message is assigned a `shardTag` indicating its shard, and the message and subsequent ones are signed with the `advance-id`, `shardTag`, and a sequence number.

#### Scenario: Message receives shardTag on arrival
- **WHEN** the entry node receives a new message
- **THEN** it assigns a `shardTag` using round-robin allocation (counter % 1048576) and includes it in the BEGIN_ADVANCE_SEGMENT message

#### Scenario: shardTag used in segment announcement
- **WHEN** the entry node sends BEGIN_ADVANCE_SEGMENT to sync hosts and NDB storages
- **THEN** the message includes the assigned `shardTag` for that segment

#### Scenario: Recovery preserves shard sequence
- **WHEN** an entry node restarts and resumes message processing
- **THEN** it queries storage via INIT_ENTRY_ACCEPTED to recover the highest known shardTag and resumes allocation from the next shard

### Requirement: HyperNet Protocol Message Format
The HyperNet protocol messages use a `shardTag` field (replacing the generic `tag` field) to communicate shard assignments through the distributed system. Messages affected: BEGIN_ADVANCE_SEGMENT, ADVANCE_SEGMENT_OVER, GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT.

#### Scenario: Protocol body includes shardTag
- **WHEN** any HyperNet message is constructed
- **THEN** it includes a `shardTag` field with format "s" followed by a numeric shard ID [0-4095]

#### Scenario: shardTag immutability through lifecycle
- **WHEN** a message flows from entry through sync cluster to resolution
- **THEN** the shardTag value remains constant across all protocol stages and is not modified by intermediate nodes

### Requirement: Shard-Aware Storage and Routing
Storage nodes (NDB) and synchronization components use the `shardTag` field for placement hints and deterministic routing decisions. The `shardTag` becomes part of the message metadata for storage affinity and load distribution. Each NDB node SHALL compute and store a `msg_shard` value derived from `shardTag` using its configured `divider` parameter.

#### Scenario: Storage receives shardTag metadata
- **WHEN** an NDB node processes KEEP_ADVANCE_HISTORY or other messages with shardTag
- **THEN** it preserves the shardTag in its internal storage metadata for future queries and routing decisions

#### Scenario: Synchronizer propagates shardTag
- **WHEN** the sync cluster processes messages containing shardTag
- **THEN** all outgoing messages (GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT) propagate the same shardTag value unchanged

### Requirement: NDB Configuration with Shard Divider
Each NDB storage node SHALL be configured with a `divider` parameter (default: 1048576) that defines the shard scheme. The divider parameter MUST be consistent across all NDB nodes in a cluster. The divider is used to compute `msg_shard = (shardTag_numeric % divider)` when storing events.

#### Scenario: NDB receives divider configuration
- **WHEN** an NDB node is initialized
- **THEN** it loads the `divider` configuration value from its config file (default: 1048576)

#### Scenario: Consistent divider across cluster
- **WHEN** multiple NDB nodes in a distributed cluster are configured
- **THEN** all nodes use the same divider value to ensure deterministic msg_shard computation

#### Scenario: Divider determines physical shard slots
- **WHEN** an NDB is configured with divider=512
- **THEN** the 1048576 virtual shards from the entry node are bucketed into 512 physical slots: shards [0-7] → slot 0, [8-15] → slot 1, etc.

### Requirement: msg_shard Storage in event_history Table
The `event_history_${realmName}` table SHALL include a `msg_shard` column that stores the physical shard assignment for each event. The column SHALL be indexed for efficient shard-range queries. The `msg_shard` value is computed as `(shardTag_numeric % divider)` at storage time and is immutable.

#### Scenario: msg_shard computed on INSERT
- **WHEN** an NDB stores a KEEP_ADVANCE_HISTORY message with shardTag "s2048" and divider=512
- **THEN** the event_history row includes msg_shard = (2048 % 512) = 0

#### Scenario: msg_shard indexed for diagnostics
- **WHEN** an operator needs to query events by shard
- **THEN** a composite index on (realm, msg_shard, timestamp) enables efficient range queries

#### Scenario: Backward compatibility with null msg_shard
- **WHEN** querying event_history that contains events from before msg_shard column was added
- **THEN** legacy rows have msg_shard=NULL; after backfill and schema migration, all rows have computed values

#### Scenario: msg_shard determines event placement
- **WHEN** an NDB with divider=4 stores messages with shardTags 0-15
- **THEN** messages distribute across 4 msg_shard slots: shardTag 0,4,8,12 → msg_shard 0; shardTag 1,5,9,13 → msg_shard 1, etc.
