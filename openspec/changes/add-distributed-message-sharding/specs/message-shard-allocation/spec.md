## ADDED Requirements

### Requirement: Round-robin shard allocation at entry node
The entry node SHALL allocate incoming segments to virtual shards using a deterministic round-robin strategy, cycling through 2^20 (1048576) virtual shards. Each new segment increments the allocation counter and assigns `shardTag = counter % 1048576` as a plain integer.

#### Scenario: Sequential allocation
- **WHEN** the entry node creates two consecutive segments
- **THEN** consecutive shardTag values differ by 1 modulo 1048576

#### Scenario: Shard wraparound
- **WHEN** the counter reaches 1048576
- **THEN** the next segment receives shardTag "s0" and the counter continues from 1

#### Scenario: Random startup
- **WHEN** an entry node starts or restarts
- **THEN** the shard counter is initialised to a random integer in `[0, 1048575]`
- **AND** subsequent segments continue round-robin allocation from that value

### Requirement: shardTag field in protocol messages
The HyperNet protocol messages (BEGIN_ADVANCE_SEGMENT, ADVANCE_SEGMENT_OVER, GENERATE_DRAFT, PICK_CHALLENGER, ELECT_SEGMENT) SHALL carry a `shardTag: number` field with the allocated virtual shard identifier.

#### Scenario: shardTag in segment initialisation
- **WHEN** an entry node creates a BEGIN_ADVANCE_SEGMENT message
- **THEN** the message includes `shardTag` as a plain integer (e.g. `42`)

#### Scenario: shardTag propagation through sync cluster
- **WHEN** a sync node receives GENERATE_DRAFT with a given shardTag
- **THEN** the same shardTag integer appears unchanged in PICK_CHALLENGER and ELECT_SEGMENT

#### Scenario: shardTag range
- **WHEN** a shardTag is generated
- **THEN** it is an integer in `[0, 1048575]`

### Requirement: Topic-based routing of KEEP_ADVANCE_HISTORY
The entry node SHALL publish `KEEP_ADVANCE_HISTORY` to a shard-specific topic rather than a broadcast topic. The topic is `keepHistory_<schemaName>.<bucket>` where `schemaName` is the event node schema name from config and `bucket = shardTag % shardCount`.

#### Scenario: Topic name for shard bucket
- **WHEN** a segment has shardTag `42`, schema name is `"main"`, and `shardCount` is 16
- **THEN** `KEEP_ADVANCE_HISTORY` is published to topic `keepHistory_main.10` (42 % 16 = 10)

#### Scenario: Schema name namespaces the topics
- **WHEN** the cluster uses schema `"main"`
- **THEN** all `KEEP_ADVANCE_HISTORY` topics have the prefix `keepHistory_main.`
- **AND** a second schema `"main2"` with a different `shardCount` uses `keepHistory_main2.*` topics, allowing both to coexist during topology transitions

#### Scenario: Segment exposes its destination topic
- **WHEN** `getDestinationTopics()` is called on a segment with shardTag `5`, schema `"main"`, shardCount `16`
- **THEN** it returns `['keepHistory_main.5']`

### Requirement: Storage node self-discovers schema membership from config
A storage node SHALL be launched with only `--node-id <id>`. On startup it SHALL scan all schemas in the `eventNodes` config section, collect every schema where its node ID appears, and subscribe to `keepHistory_<schemaName>.<bucket>` for each owned bucket across all matching schemas.

#### Scenario: Node discovers its schemas and subscribes
- **WHEN** a storage node starts with `--node-id NDB1`
- **AND** the config has `eventNodes.main.NDB1.shards = [0, 1, 2, 3]` with `shardCount = 16`
- **THEN** it subscribes to `keepHistory_main.0`, `keepHistory_main.1`, `keepHistory_main.2`, `keepHistory_main.3`

#### Scenario: Node appears in multiple schemas
- **WHEN** node NDB1 is listed in both schema `"main"` (shards `[0]`, shardCount 16) and schema `"archive"` (shards `[0, 1]`, shardCount 4)
- **THEN** it subscribes to `keepHistory_main.0`, `keepHistory_archive.0`, and `keepHistory_archive.1`

#### Scenario: Node does not receive messages for other shards
- **WHEN** a segment is published with shardTag `42` (bucket 10 in a 16-shard schema)
- **AND** node NDB1 owns shards `[0, 1, 2, 3]`
- **THEN** NDB1 does not receive that `KEEP_ADVANCE_HISTORY` message

#### Scenario: Schema consistency between entry and storage nodes
- **WHEN** entry and storage nodes read from the same config file
- **THEN** topic names match exactly and no messages are lost or misrouted

### Requirement: Event history table includes schema name
Event history SHALL be stored in a table named `event_history_<schemaName>_<realmName>`, keeping data from different schemas isolated in separate tables. Migration of existing tables is a manual operational step.

#### Scenario: Table name for schema "main"
- **WHEN** a `KEEP_ADVANCE_HISTORY` message arrives for realm `"prod"` via schema `"main"`
- **THEN** the event is stored in table `event_history_main_prod`
