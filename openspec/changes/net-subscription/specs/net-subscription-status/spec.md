# net-subscription-status Specification

## Purpose

Defines `NetSubStatusFactory` on the entry node: tracks whether any storage node has ever connected, to gate `supportsRetainedEventSync`. It does **not** track which node serves which shard, or rank nodes by freshness — shard dispatch (including replication) is handled entirely by shared RPC registration on the per-shard `fox.storage.history.fetch.<shardTag>` procedures (see `net-history-fetch`), so the entry has no need to enumerate or select storage nodes itself.

## Requirements

### Requirement: Storage node announces on connect

When a storage node calls `listenEntry`, it SHALL announce to the connecting entry, via the `client` connection passed into `listenEntry` (using the existing `pipe()` bridging idiom — not by publishing only on the storage node's own local realm), containing at minimum its node ID.

#### Scenario: Announcement published on listenEntry

- **WHEN** `EventStorageTask.listenEntry(entryClient, gateId)` is called
- **THEN** the storage task SHALL bridge `STORAGE_NODE_CONNECTED` to the entry via `this.api.pipe(entryClient, Event.STORAGE_NODE_CONNECTED)` followed by publishing `{ nodeId: string }` on `this.api`
- **AND** the entry SHALL receive the announcement regardless of whether entry and storage happen to share the same realm object (this must not rely on same-realm dispersal as an implicit delivery mechanism)

### Requirement: NetSubStatusFactory tracks connection existence only

`NetSubStatusFactory` on the entry node SHALL subscribe to `STORAGE_NODE_CONNECTED` and record that at least one storage node has connected. It SHALL NOT maintain a per-shard node list, per-node `lastEventId`, or any node-selection state — that responsibility does not exist on the entry side under this design.

#### Scenario: First storage node connects

- **WHEN** `STORAGE_NODE_CONNECTED` arrives with `{ nodeId: 'NDB1' }`
- **THEN** `NetSubStatusFactory.hasStorageNodes()` SHALL return `true`

#### Scenario: Multiple storage nodes connect, including replicas of the same shard

- **WHEN** `STORAGE_NODE_CONNECTED` arrives from `NDB1` and later from `NDB2` (regardless of whether they cover overlapping shards)
- **THEN** `NetSubStatusFactory.hasStorageNodes()` SHALL remain `true`
- **AND** `NetSubStatusFactory` SHALL NOT need to record which shards either node covers — shard-level dispatch is handled by RPC registration, not by this factory

### Requirement: supportsRetainedEventSync toggled at runtime

`NetEngine.supportsRetainedEventSync` SHALL return `true` when at least one storage node is connected (announced). It SHALL be `false` before any storage node connects.

#### Scenario: Enabled on first connect

- **WHEN** the first `STORAGE_NODE_CONNECTED` is absorbed by `NetSubStatusFactory`
- **THEN** `NetEngine.supportsRetainedEventSync` SHALL return `true`

#### Scenario: Disabled before any connect

- **WHEN** no `STORAGE_NODE_CONNECTED` has been received
- **THEN** `NetEngine.supportsRetainedEventSync` SHALL return `false`
