## ADDED Requirements

### Requirement: Round-robin shard allocation at entry node
The entry node SHALL allocate incoming segments to shards using a deterministic round-robin strategy, cycling through 2^3 (8) shards. Each new segment increments the allocation counter and assigns `shardTag = counter % 8` as a plain integer.

#### Scenario: Sequential allocation
- **WHEN** the entry node creates two consecutive segments
- **THEN** consecutive shardTag values differ by 1 modulo 8

#### Scenario: Shard wraparound
- **WHEN** the counter reaches 8
- **THEN** the next segment receives shardTag 0 and the counter continues from 1

#### Scenario: Random startup
- **WHEN** an entry node starts or restarts
- **THEN** the shard counter is initialised to a random integer in `[0, 7]`
- **AND** subsequent segments continue round-robin allocation from that value

### Requirement: shardTag field in protocol messages
The HyperNet protocol messages (BEGIN_ADVANCE_SEGMENT, ADVANCE_SEGMENT_OVER, GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT) SHALL carry a `shardTag: number` field with the allocated shard identifier.

#### Scenario: shardTag in segment initialisation
- **WHEN** an entry node creates a BEGIN_ADVANCE_SEGMENT message
- **THEN** the message includes `shardTag` as a plain integer in `[0, 7]`

#### Scenario: shardTag propagation through sync cluster
- **WHEN** a sync node receives GENERATE_DRAFT with a given shardTag
- **THEN** the same shardTag integer appears unchanged in PICK_CHALLENGER and ELECT_SEGMENT

#### Scenario: shardTag range
- **WHEN** a shardTag is generated
- **THEN** it is an integer in `[0, 7]`

### Requirement: Topic-based routing of KEEP_ADVANCE_HISTORY
The entry node SHALL publish `KEEP_ADVANCE_HISTORY` to a shard-specific sub-topic rather than broadcasting. The topic is `KEEP_ADVANCE_HISTORY.<shardTag>`, generated via `Event.keepAdvanceHistoryTopic(shardTag)`. The shardTag is used directly with no modulo division.

#### Scenario: Topic name for shardTag
- **WHEN** a segment has shardTag `5`
- **THEN** `KEEP_ADVANCE_HISTORY` is published to topic `KEEP_ADVANCE_HISTORY.5`

#### Scenario: Segment exposes its destination topic
- **WHEN** `getDestinationTopics()` is called on a segment with shardTag `5`
- **THEN** it returns `['KEEP_ADVANCE_HISTORY.5']`

### Requirement: Storage node discovers its shards from config
A storage node SHALL be launched with `NODE_ID` env var. On startup it SHALL look up its entry in `eventNodes`, read its `shards` array, and subscribe to `KEEP_ADVANCE_HISTORY.<shardTag>` for each owned shardTag value. The shard space size is fixed at `TOTAL_SHARDS_COUNT = 8`.

#### Scenario: Node discovers its shards and subscribes
- **WHEN** a storage node starts with `NODE_ID=NDB1`
- **AND** the config has `eventNodes.NDB1.shards = [0, 1]`
- **THEN** it subscribes to `KEEP_ADVANCE_HISTORY.0` and `KEEP_ADVANCE_HISTORY.1`

#### Scenario: Node does not receive messages for unowned shardTags
- **WHEN** a segment is published with shardTag `5`
- **AND** node NDB1 owns shards `[0, 1]`
- **THEN** NDB1 does not receive that `KEEP_ADVANCE_HISTORY` message

#### Scenario: Config consistency between entry and storage nodes
- **WHEN** entry and storage nodes read from the same config file
- **THEN** topic names match exactly and no messages are lost or misrouted

### Requirement: Event history table name unchanged
Event history SHALL be stored in `event_history_<realmName>`, the same table name used in the non-distributed (broadcast) mode.

#### Scenario: Table name for sharded delivery
- **WHEN** a `KEEP_ADVANCE_HISTORY` message arrives for realm `"prod"` via a shard topic
- **THEN** the event is stored in table `event_history_prod`
