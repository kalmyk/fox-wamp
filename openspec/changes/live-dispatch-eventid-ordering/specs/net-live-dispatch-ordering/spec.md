## Purpose

Defines the per-subscription delivery-order guarantee for the live-tail dispatch path (`net-live-dispatch`): once a live event has reached a given subscription, no subsequently-delivered live event on that same subscription may carry a smaller `eventId`, regardless of which shard or storage-node broadcast produced either event.

## ADDED Requirements

### Requirement: Live delivery order is non-decreasing per subscription

For a given subscription, the live-tail dispatch path SHALL NOT invoke that subscription's delivery callback with an event whose `eventId` is smaller (by string comparison, per the project's existing convention of comparing distributed event IDs as opaque strings — see `retained-state-event-sync`) than the `eventId` of an event already delivered to that same subscription. This applies regardless of which shard, or which storage-node replica of a shard, produced either event, and regardless of the wall-clock gap between the two underlying `Event.SEGMENT_COMMITTED` broadcasts that carried them.

This requirement is distinct from, and not satisfied by, `net-live-dispatch`'s existing exact-`eventId` de-duplication (`SeenEventWindow`): de-duplication only recognizes a byte-identical repeat of an `eventId` already seen: it has no notion of relative order and does not prevent two *different* `eventId`s from being delivered in descending order.

#### Scenario: Cross-shard out-of-order broadcasts are not delivered out of order

- **WHEN** shard A commits and broadcasts a `SEGMENT_COMMITTED` batch containing `eventId "E100"`, and this reaches the entry first
- **AND** shard B, independently and on its own timeline, subsequently commits and broadcasts a `SEGMENT_COMMITTED` batch containing `eventId "E050"` (an `eventId` that sorts before `"E100"`), which reaches the entry second
- **AND** a subscription on this entry matches both events
- **THEN** the subscription's delivery callback SHALL NOT observe `"E100"` followed by `"E050"`
- **AND** SHALL observe every delivered `eventId` in non-decreasing order for that subscription

#### Scenario: Dedup alone does not satisfy this requirement

- **WHEN** `NetEngineMill.dispatchLiveEvents` (or an equivalent live-tail dispatch path) has already passed `"E100"` and `"E050"` through `SeenEventWindow.addIfNew` in that arrival order
- **THEN** the fact that both `eventId`s are distinct and each individually passes the dedup check SHALL NOT be treated as satisfying this requirement — dedup and ordering are separate, independently-required guarantees

#### Scenario: Same-eventId duplicates remain governed by existing dedup, not by this requirement

- **WHEN** two storage-node replicas of the same shard each broadcast the identical `eventId`
- **THEN** this requirement is not what prevents a second delivery of that `eventId` — that remains the responsibility of `net-live-dispatch`'s existing `SeenEventWindow` de-duplication

### Requirement: Committed-segment markers identify their emitting origin

Every `SEGMENT_COMMITTED` broadcast SHALL carry an `origin` field identifying the node that emitted it, so that a consumer can tell which node it is still waiting for before treating a range of event ids as complete. The field SHALL be uniform across emitters — it SHALL NOT be a shard tag, because markers may also pass through nodes that have no shard.

#### Scenario: Storage node stamps its own id

- **WHEN** a storage node commits a segment and broadcasts `SEGMENT_COMMITTED`
- **THEN** the broadcast SHALL carry `origin` equal to that storage node's id

#### Scenario: Consumers that ignore origin keep working

- **WHEN** a consumer that predates the `origin` field receives a `SEGMENT_COMMITTED` broadcast carrying it
- **THEN** the consumer SHALL process the broadcast exactly as it did without the field

### Requirement: History fetch supports an inclusive upper bound

The per-shard history fetch request SHALL accept an optional `untilEventId`. When present, the responding storage node SHALL stream only events with `eventId` greater than `afterEventId` (when given) and less than or equal to `untilEventId`. When absent or `null`, the request SHALL behave exactly as it did before the field existed.

#### Scenario: Bounded fetch stops at the bound

- **WHEN** a consumer requests history for a realm with `afterEventId "E100"` and `untilEventId "E200"`
- **THEN** the storage node SHALL stream only events whose `eventId` is in the range `("E100", "E200"]`
- **AND** SHALL NOT stream events committed after `"E200"`

#### Scenario: Unbounded fetch is unchanged

- **WHEN** a consumer requests history without `untilEventId`
- **THEN** the storage node SHALL stream every matching event after `afterEventId`, as before

### Requirement: Delivery up to a stable point only

A consumer of `SEGMENT_COMMITTED` markers SHALL deliver events only up to a stable point, meaning the highest event id that every shard's coverage has reached, and SHALL deliver the events in that range in non-decreasing `eventId` order.

#### Scenario: Delivery waits for the slowest shard

- **GIVEN** shard A has reported a marker at `"E100"` and shard B has reported a marker only at `"E050"`
- **WHEN** the consumer evaluates what it may deliver
- **THEN** it SHALL NOT deliver any event with `eventId` greater than `"E050"`
- **AND** SHALL deliver events up to `"E050"` in non-decreasing order

#### Scenario: A replicated shard advances on its first-reporting owner

- **GIVEN** a shard is owned by two storage nodes and one of them has reported a marker at `"E100"`
- **WHEN** the other owner has not yet reported
- **THEN** the shard's coverage SHALL be treated as having reached `"E100"`
