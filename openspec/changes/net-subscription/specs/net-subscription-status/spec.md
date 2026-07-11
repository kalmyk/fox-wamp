# net-subscription-status Specification

## Purpose

Defines `NetSubStatusFactory` on the entry node: tracks connected storage nodes, their shard assignments, and their last known committed event ID. Used to decide which storage node to call for a given realm and whether history is available.

## Requirements

### Requirement: Storage node announces on connect

When a storage node calls `listenEntry`, it SHALL publish `STORAGE_NODE_CONNECTED` on the sys realm containing its node ID, the shard tags it owns, and the last committed event ID across all its realms.

#### Scenario: Announcement published on listenEntry

- **WHEN** `EventStorageTask.listenEntry(entryClient, gateId)` is called
- **THEN** the storage task SHALL publish `STORAGE_NODE_CONNECTED` on the sys realm with `{ nodeId: string, shards: number[], lastEventId: string | null }`
- **AND** `lastEventId` SHALL be the result of `scanMaxId(db)` at the time of connection

### Requirement: NetSubStatusFactory absorbs shard announcements

`NetSubStatusFactory` on the entry node SHALL subscribe to `STORAGE_NODE_CONNECTED` and maintain a per-shard list of `{ nodeId, storageClient, lastEventId }`.

#### Scenario: First storage node for a shard

- **WHEN** `STORAGE_NODE_CONNECTED` arrives with `{ nodeId: 'NDB1', shards: [0,1,2,3], lastEventId: 'EVT_X' }`
- **THEN** `NetSubStatusFactory` SHALL record `nodeId='NDB1'` as serving shards 0, 1, 2, and 3
- **AND** `lastEventId` SHALL be stored as `'EVT_X'` for nodeId `'NDB1'`

#### Scenario: Second storage node for same shard (multi-node)

- **WHEN** a second `STORAGE_NODE_CONNECTED` arrives with `{ nodeId: 'NDB2', shards: [0], lastEventId: 'EVT_Y' }`
- **THEN** both `NDB1` and `NDB2` SHALL be tracked for shard 0
- **AND** each entry SHALL retain its own `lastEventId`

### Requirement: Connected node list used for fetch dispatch

`NetSubStatusFactory` SHALL expose a method returning all unique connected storage node clients for a given realm. The entry uses this list to call `fox.storage.history.fetch` on each.

#### Scenario: All nodes returned for realm

- **WHEN** nodes NDB1 (shards 0–3) and NDB2 (shards 4–7) are connected
- **AND** `getStorageClientsForRealm(realm)` is called
- **THEN** both NDB1 and NDB2 SHALL be returned (any node may have realm events within its shards)

#### Scenario: No nodes connected

- **WHEN** no storage nodes have announced
- **THEN** `getStorageClientsForRealm(realm)` SHALL return an empty array

### Requirement: supportsRetainedEventSync toggled at runtime

`NetEngine.supportsRetainedEventSync` SHALL return `true` when at least one storage node is connected (announced). It SHALL be `false` before any storage node connects.

#### Scenario: Enabled on first connect

- **WHEN** the first `STORAGE_NODE_CONNECTED` is absorbed by `NetSubStatusFactory`
- **THEN** `NetEngine.supportsRetainedEventSync` SHALL return `true`

#### Scenario: Disabled before any connect

- **WHEN** no `STORAGE_NODE_CONNECTED` has been received
- **THEN** `NetEngine.supportsRetainedEventSync` SHALL return `false`
