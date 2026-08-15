# net-subscription-buffer Specification

## Purpose

Defines `SharedSegmentBuffer`: a per-realm, per-entry-node in-memory buffer that holds events fetched from storage. Multiple `ActorNetSub` instances share one buffer per realm, so a realm's history is fetched at most once regardless of how many local subscribers request it. The buffer fetches by calling `fox.storage.history.fetch.<shardTag>` for every shard tag (a fixed, known range — `0` through `TOTAL_SHARDS_COUNT - 1`), not by discovering or selecting specific storage node clients.

## Requirements

### Requirement: One buffer per realm on entry

`NetEngineMill` SHALL maintain at most one `SharedSegmentBuffer` per realm name. All `ActorNetSub` instances for the same realm SHALL use the same buffer instance.

#### Scenario: Second subscriber reuses existing buffer

- **WHEN** a `SharedSegmentBuffer` for realm `myapp` already exists and is loading
- **AND** a second `ActorNetSub` for realm `myapp` requests history
- **THEN** no new fetch pass SHALL be started
- **AND** both actors SHALL receive events from the same buffer

### Requirement: Buffer fetches every shard tag via per-shard RPC

When a `SharedSegmentBuffer` is first accessed for a realm and no fetch is in progress, it SHALL call `fox.storage.history.fetch.<shardTag>` for every `shardTag` from `0` to `TOTAL_SHARDS_COUNT - 1`, concurrently, using the entry's own sys-realm API client. It SHALL NOT require a list of storage node clients to be supplied by the caller — shard coverage (including replication) is resolved by the RPC dispatch itself, not by the buffer.

#### Scenario: Fetch triggered on first access calls every shard

- **WHEN** `SharedSegmentBuffer.ensureLoading(realm, afterEventId)` is called for the first time
- **THEN** `fox.storage.history.fetch.<shardTag>` SHALL be called for every shard tag in `0..TOTAL_SHARDS_COUNT-1`
- **AND** `loading` SHALL be set to `true`

#### Scenario: A shard with no registrant does not block the others

- **WHEN** one of the `TOTAL_SHARDS_COUNT` calls fails with `ERROR_NO_SUCH_PROCEDURE` (no storage node currently owns that shard)
- **THEN** that shard SHALL be treated as contributing zero events, immediately
- **AND** the remaining shards' calls SHALL proceed and be waited on independently

### Requirement: Fetch always completes — never conditioned on a discovered node count

Because the number of calls (`TOTAL_SHARDS_COUNT`) is a fixed constant known in advance, `ensureLoading` SHALL always have a known, finite set of outcomes to wait on, whether or not any storage node is currently connected.

#### Scenario: Zero storage nodes connected anywhere

- **WHEN** `ensureLoading` is called and no storage node has registered any shard procedure
- **THEN** every one of the `TOTAL_SHARDS_COUNT` calls SHALL fail with `ERROR_NO_SUCH_PROCEDURE`
- **AND** the buffer SHALL still reach `done = true` promptly (not hang), since all outcomes — success or "no such procedure" — resolve the same fixed set of pending calls

### Requirement: Events appended in event_id ASC order

Events received from all shard progress calls SHALL be merged into a single append-only list sorted by `event_id ASC`. Out-of-order events from different shards SHALL be interleaved correctly.

#### Scenario: Two-shard merge in event_id order

- **WHEN** shard 0's calls emit events `[EVT_10, EVT_20]` and shard 4's calls emit `[EVT_15, EVT_25]`
- **THEN** the buffer's event list SHALL be `[EVT_10, EVT_15, EVT_20, EVT_25]`

#### Scenario: Out-of-order delivery detected

- **WHEN** an event with `event_id < buffer.lastEventId` is received (from any shard's call)
- **THEN** the buffer SHALL log an error indicating out-of-order delivery
- **AND** SHALL still append the event at its correct sorted position

### Requirement: Duplicate event IDs are not appended twice

If an event with an `event_id` already present in the buffer is received again — expected when a shard's call is retried after its original registrant failed mid-stream and a different (or the same, recovered) registrant serves the retry — the buffer SHALL discard the duplicate rather than appending a second copy.

#### Scenario: Retry re-delivery is deduplicated

- **WHEN** the buffer already contains `EVT_10` (received from whichever registrant originally served shard 0's call)
- **AND** shard 0's call is retried after a mid-stream failure, and the retry's registrant re-delivers `EVT_10` as part of its response
- **THEN** the buffer SHALL NOT append a second `EVT_10`
- **AND** SHALL NOT log this as an out-of-order-delivery error (it is an expected retry overlap, not a data-integrity problem)

### Requirement: Waiters notified on new events

Any caller waiting for events past a given cursor SHALL be notified when new events are appended.

#### Scenario: Waiter unblocked when event arrives

- **WHEN** an `ActorNetSub` is waiting for events after `EVT_X`
- **AND** the buffer receives an event `EVT_Y` where `EVT_Y > EVT_X`
- **THEN** the waiter callback SHALL be invoked

### Requirement: Done flag set when all shard calls complete

When all `TOTAL_SHARDS_COUNT` shard calls have resolved (whether with `{ done: true }` after streaming events, or with `ERROR_NO_SUCH_PROCEDURE` treated as zero events), the buffer SHALL set `done = true` and notify all remaining waiters.

#### Scenario: Waiters unblocked on completion

- **WHEN** all shard calls have resolved, by whatever outcome
- **AND** an `ActorNetSub` is still waiting for events that do not exist
- **THEN** the waiter SHALL be notified with `done = true` so it can release the actor
