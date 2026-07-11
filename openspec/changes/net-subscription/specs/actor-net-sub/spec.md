# actor-net-sub Specification

## Purpose

Defines the behavior of `ActorNetSub` (the distributed-mode history actor) that drives the fetch-and-deliver loop: reads from `SharedSegmentBuffer`, delivers history in `event_id ASC` order, and gates live event delivery until catch-up is complete.

## Requirements

### Requirement: History delivered before live events

`ActorNetSub` SHALL hold back live events (`actor.traceStarted = false`) until all historical events after the subscriber's `afterEventId` have been delivered.

#### Scenario: Live delivery gated until replay done

- **WHEN** a subscriber connects with `after: 'EVT_100'`
- **AND** storage has events `EVT_101`, `EVT_102`, `EVT_103`
- **THEN** the actor SHALL deliver `EVT_101`, `EVT_102`, `EVT_103` before setting `traceStarted = true`
- **AND** any live events that arrived while replaying SHALL be held in the delay stack
- **AND** live events SHALL be flushed after `traceStarted = true`

#### Scenario: No history to replay

- **WHEN** a subscriber connects with `after: 'EVT_200'` and no events exist after `EVT_200`
- **THEN** the actor SHALL set `traceStarted = true` immediately after the buffer signals `done`

### Requirement: Events delivered in event_id ASC order

`ActorNetSub` SHALL iterate the `SharedSegmentBuffer` from the first event with `event_id > afterEventId` and deliver each event in ascending order.

#### Scenario: ASC delivery verified

- **WHEN** the buffer contains `[EVT_101, EVT_102, EVT_103]` and subscriber has `after: 'EVT_100'`
- **THEN** the actor SHALL call `cbRow` with `EVT_101`, then `EVT_102`, then `EVT_103` in that order

#### Scenario: Out-of-order detected and logged

- **WHEN** the actor is about to deliver an event with `event_id` less than the previously delivered `event_id`
- **THEN** the actor SHALL log an error: `"net-sub: out-of-order event <id> after <lastId>"`
- **AND** SHALL still deliver the event

### Requirement: URI filter applied during delivery

`ActorNetSub` SHALL apply the subscription's URI pattern filter when iterating buffer events. Events that do not match the subscriber's URI SHALL be skipped.

#### Scenario: URI-filtered delivery

- **WHEN** subscriber pattern is `['sensor', '#']`
- **AND** the buffer contains events for `['sensor', 'temp']`, `['other', 'x']`, `['sensor', 'humidity']`
- **THEN** only `['sensor', 'temp']` and `['sensor', 'humidity']` SHALL be delivered

### Requirement: getHistoryAfter drives ActorNetSub

`NetEngine.getHistoryAfter(after, uri, cbRow)` SHALL obtain or create the `SharedSegmentBuffer` for the realm, trigger loading if not already in progress, and iterate events from `after` position using the buffer's drain API.

#### Scenario: getHistoryAfter resolves after replay

- **WHEN** `getHistoryAfter('EVT_100', ['#'], cbRow)` is called
- **AND** the buffer eventually loads all events and sets `done = true`
- **THEN** the returned promise SHALL resolve after all matching events have been passed to `cbRow`
