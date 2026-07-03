## MODIFIED Requirements

### Requirement: Entry Initialization with Shard Allocation
When a message arrives, a unique `advance-id` is created. The entry node SHALL handle shard allocation via deterministic round-robin across 2^3 (8) shards. Each incoming message SHALL be assigned a `shardTag` indicating its shard, and the message and subsequent ones are signed with the `advance-id`, `shardTag`, and a sequence number.

#### Scenario: Message receives shardTag on arrival
- **WHEN** the entry node receives a new message
- **THEN** it assigns a `shardTag` using round-robin allocation (counter % 8) and includes it in the BEGIN_ADVANCE_SEGMENT message

#### Scenario: shardTag used in segment announcement
- **WHEN** the entry node sends BEGIN_ADVANCE_SEGMENT to sync hosts and NDB storages
- **THEN** the message includes the assigned `shardTag` for that segment

#### Scenario: Startup chooses random shard position
- **WHEN** an entry node restarts and resumes message processing
- **THEN** it initializes the shard counter to a random value in the 2^3 shard space and resumes round-robin allocation from that value

### Requirement: HyperNet Protocol Message Format
The HyperNet protocol messages SHALL use a `shardTag` field (replacing the generic `tag` field) to communicate shard assignments through the distributed system. Messages affected: BEGIN_ADVANCE_SEGMENT, ADVANCE_SEGMENT_OVER, GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT.

#### Scenario: Protocol body includes shardTag
- **WHEN** any HyperNet message is constructed
- **THEN** it includes a `shardTag` field as a plain integer in `[0, 7]`

#### Scenario: shardTag immutability through lifecycle
- **WHEN** a message flows from entry through sync cluster to resolution
- **THEN** the shardTag value remains constant across all protocol stages and is not modified by intermediate nodes

### Requirement: Shard-Aware Storage and Routing
Storage nodes (NDB) subscribe to shard-specific topics and store events in the `event_history_<realmName>` table. Each NDB node owns a set of `shardTag` values listed directly in its `shards` config array and subscribes to `keepHistory.<shardTag>` for each owned value.

#### Scenario: Storage receives shardTag metadata
- **WHEN** an NDB node processes KEEP_ADVANCE_HISTORY via a shard topic
- **THEN** it preserves the `shard` field (the shardTag) in the `msg_shard` column of `event_history_<realmName>`

#### Scenario: Synchronizer propagates shardTag
- **WHEN** the sync cluster processes messages containing shardTag
- **THEN** all outgoing messages (GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT) propagate the same shardTag value unchanged

### Requirement: NDB Configuration with Owned Shards
Each NDB storage node SHALL be configured with a `shards` array listing the shardTag values it owns. The union of all nodes' `shards` arrays SHOULD cover `[0, TOTAL_SHARDS_COUNT-1]` with no overlaps. `TOTAL_SHARDS_COUNT = 8` is the size of the virtual shard space.

#### Scenario: NDB discovers owned shards on startup
- **WHEN** an NDB node is initialized with `NODE_ID=NDB1`
- **THEN** it reads `eventNodes.NDB1.shards` from config and subscribes to `keepHistory.<shardTag>` for each value

#### Scenario: Each shardTag maps to exactly one topic
- **WHEN** a segment has shardTag `3`
- **THEN** `KEEP_ADVANCE_HISTORY` is published to `keepHistory.3` — no modulo, no division

#### Scenario: Node does not receive messages for unowned shardTags
- **WHEN** a segment is published with shardTag `5` and NDB1 owns `[0, 1]`
- **THEN** NDB1 does not receive that `KEEP_ADVANCE_HISTORY` message

### Requirement: msg_shard Storage in event_history Table
The `event_history_${realmName}` table SHALL include a `msg_shard` column that stores the shardTag for each event. The column SHALL be indexed for efficient shard-range queries.

#### Scenario: msg_shard stored on INSERT
- **WHEN** an NDB stores a KEEP_ADVANCE_HISTORY message with shardTag `3`
- **THEN** the event_history row includes `msg_shard = 3`
