## ADDED Requirements

### Requirement: Round-robin shard allocation at entry node
The entry node SHALL allocate incoming messages to shards using a deterministic round-robin strategy, cycling through 2^20 (1048576) shards. Each new message increments the allocation counter and assigns the message to shard (counter % 1048576).

#### Scenario: First message allocation
- **WHEN** the entry node receives its first message
- **THEN** the message is assigned to shard 0 and the counter increments to 1

#### Scenario: Shard wraparound
- **WHEN** the counter reaches 1048576
- **THEN** the next message is assigned to shard 0 and the counter wraps (counter % 1048576 = 0)

#### Scenario: Random startup after restart
- **WHEN** an entry node starts or restarts
- **THEN** the entry node initializes its shard counter to a random value in the range [0, 1048575]
- **AND** subsequent messages continue round-robin allocation from that value

### Requirement: Formalized shardTag field in protocol messages
The HyperNet protocol messages (BEGIN_ADVANCE_SEGMENT, ADVANCE_SEGMENT_OVER, GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT) SHALL use a `shardTag` field to carry the shard assignment through the message lifecycle.

#### Scenario: shardTag in segment initialization
- **WHEN** an entry node initiates a new advance segment via BEGIN_ADVANCE_SEGMENT
- **THEN** the message includes `shardTag` set to the allocated shard identifier

#### Scenario: shardTag propagation through sync cluster
- **WHEN** a sync cluster receives GENERATE_DRAFT message with shardTag
- **THEN** all downstream messages (PICK_CHALLENGER, ELECT_SEGMENT) retain and propagate the same shardTag value

#### Scenario: shardTag format
- **WHEN** a shardTag is generated
- **THEN** it has the format "s" followed by a numeric shard ID in the range [0, 1048575]

### Requirement: Shard-aware message routing
Storage nodes and routing components SHALL use the shardTag field to make deterministic placement or affinity decisions for message storage and synchronization.

#### Scenario: Storage node receives message with shardTag
- **WHEN** an NDB storage node receives a message with shardTag "s512"
- **THEN** it routes or stores the message using shard 512 as a placement hint

#### Scenario: Shard information preserved in logs and traces
- **WHEN** a message flows through the system
- **THEN** logging and diagnostic output includes the shardTag for debugging and monitoring

### Requirement: NDB shard scheme configuration with divider
Each NDB storage node SHALL be configured with a `divider` parameter that maps the entry node's 1048576 virtual shards to physical shard slots. The NDB SHALL compute `msg_shard = (shardTag_numeric % divider)` when storing events, where `shardTag_numeric` is the numeric portion of the shardTag field (e.g., 512 from "s512").

#### Scenario: NDB with default divider
- **WHEN** an NDB is configured with divider=1048576 (default)
- **THEN** `msg_shard = (shardTag_numeric % 1048576)` yields a 1:1 mapping: shardTag "s123" → msg_shard=123

#### Scenario: NDB with reduced divider for bucketing
- **WHEN** an NDB is configured with divider=512
- **THEN** `msg_shard = (shardTag_numeric % 512)` groups shards: shardTag "s512" → msg_shard=0, "s513" → msg_shard=1

#### Scenario: Divider configuration consistency
- **WHEN** all NDB nodes in a cluster are configured with the same divider value
- **THEN** the same shardTag consistently maps to the same msg_shard across all nodes

### Requirement: msg_shard column in event_history table
The `event_history_${realmName}` table SHALL include a `msg_shard` column that stores the computed shard value for each event. The `msg_shard` value SHALL be deterministically computed as `(shardTag_numeric % divider)` at storage time and used for efficient shard-range queries and diagnostics.

#### Scenario: msg_shard computation on event storage
- **WHEN** an NDB stores a message with shardTag "s2048" and divider=512 into event_history_myrealm
- **THEN** the row includes msg_shard=0 (2048 % 512 = 0)

#### Scenario: msg_shard index for query performance
- **WHEN** a diagnostic query needs all events for a specific shard range
- **THEN** the system can efficiently query using index on (realm, msg_shard) without full table scans

#### Scenario: Backward compatibility with legacy events
- **WHEN** querying event_history for events stored before msg_shard column was added
- **THEN** legacy events have msg_shard=NULL; new events have computed msg_shard values
