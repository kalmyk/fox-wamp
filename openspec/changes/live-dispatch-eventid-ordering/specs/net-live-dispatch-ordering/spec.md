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
