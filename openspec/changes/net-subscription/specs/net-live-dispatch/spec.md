# net-live-dispatch Specification

## Purpose

Defines live (real-time) delivery of newly-committed events from storage nodes to every connected entry, feeding `NetEngineMill`'s `disperseToSubs` call so that both plain (`after`-less) and `after`-based subscriptions on a distributed realm receive events published after they started listening. Historical catch-up (`net-history-fetch`, `net-subscription-buffer`, `actor-net-sub`) only covers replay up to the moment a fetch is issued — this capability covers everything committed afterward.

## Requirements

### Requirement: Storage broadcasts committed events via Event.SEGMENT_COMMITTED

`EventStorageTask` SHALL, immediately after `commit_segment(...)` resolves for an `ADVANCE_SEGMENT_RESOLVED` it owns data for, publish the resulting `CommittedSegmentRecord[]` as a single `Event.SEGMENT_COMMITTED` message — the same event it already `dbFactory.emit()`s in-process for `ProjectionListener` — with body `{ advanceOwner, advanceStamp, segment, events: CommittedSegmentRecord[] }` where each record is `{ eventId, realm, uri, data, opt, sid, shard }`. Records are not grouped by realm before publishing: a single commit isn't necessarily scoped to one realm, and each record already carries its own `realm`.

#### Scenario: Committed segment with data triggers dispatch

- **WHEN** `commit_segment` resolves with two events for realm `myapp` and one event for realm `other`
- **THEN** `EventStorageTask` SHALL publish exactly one `Event.SEGMENT_COMMITTED` message whose `events` array contains all three records, two tagged `realm: 'myapp'` and one tagged `realm: 'other'`

#### Scenario: No-data segment publishes nothing

- **WHEN** `commit_segment` resolves with zero events (this node does not own the shard's buffered data)
- **THEN** `EventStorageTask` SHALL NOT publish any `Event.SEGMENT_COMMITTED`

#### Scenario: Dispatch happens only after durable commit

- **WHEN** a segment is being committed to sqlite and the write has not yet completed
- **THEN** no `Event.SEGMENT_COMMITTED` SHALL be published for that segment's events until `commit_segment`'s promise resolves successfully

### Requirement: Storage pipes SEGMENT_COMMITTED to every connected entry

`EventStorageTask.listenEntry(client, gateId)` SHALL pipe `Event.SEGMENT_COMMITTED` to the connecting entry (`this.api.pipe(client, Event.SEGMENT_COMMITTED, {exclude_me: false})`), independent of which entry originally accepted the publish that led to this segment.

#### Scenario: Event reaches an entry that did not originate the publish

- **WHEN** a publish was originally accepted by entry E1, and entry E2 has a live subscriber for the same realm/topic
- **AND** the storage node servicing the resulting segment is connected to both E1 and E2 via `listenEntry`
- **THEN** E2 SHALL also receive the resulting `Event.SEGMENT_COMMITTED`

### Requirement: Entry de-duplicates before dispersing

`NetEngineMill` SHALL subscribe to `Event.SEGMENT_COMMITTED`, and for each `CommittedSegmentRecord` in the batch SHALL check a bounded, fixed-capacity dedup structure keyed by `eventId` before calling `realm.getEngine().disperseToSubs(...)`. A record whose `eventId` has already been seen (within the window) SHALL be dropped without dispersing again.

#### Scenario: Duplicate from a replicated shard is dropped

- **WHEN** two storage nodes replicating the same shard both independently commit the same segment and each publish `Event.SEGMENT_COMMITTED` for the same `eventId`
- **THEN** `NetEngineMill` SHALL call `disperseToSubs` for that `eventId` exactly once (assuming both deliveries arrive within the dedup window's capacity)

#### Scenario: Dedup window is bounded, not unbounded

- **WHEN** the number of distinct `eventId`s seen exceeds the dedup structure's fixed capacity
- **THEN** the oldest entries SHALL be evicted to make room for new ones, rather than the structure growing without bound

### Requirement: Live dispatch resolves the target realm per record

On receiving `Event.SEGMENT_COMMITTED`, `NetEngineMill` SHALL resolve, for each `CommittedSegmentRecord` in the batch, the realm via `this.router.findRealm(record.realm)`. If the realm does not exist on this entry (no local session has ever joined it), that record SHALL be dropped silently — this is not an error, since not every entry necessarily hosts every realm's subscribers, and a single batch may contain records for realms this entry doesn't host alongside ones it does.

#### Scenario: Realm not present on this entry

- **WHEN** `Event.SEGMENT_COMMITTED` arrives with a record for realm `unused` and no session has ever joined `unused` on this entry
- **THEN** `NetEngineMill` SHALL NOT throw, and SHALL simply not disperse that record

### Requirement: Delivered events respect existing subscriber gating

Once passed to `disperseToSubs`, delivery SHALL follow the existing, engine-agnostic `BaseRealm.disperseToSubs` behavior: a subscriber still completing catch-up (`traceStarted === false`) SHALL have the event delayed (`delayEvent`) rather than dropped, and flushed once catch-up completes. This capability does not change that mechanism — it only ensures `disperseToSubs` is actually invoked for `NetEngine`-hosted realms.

#### Scenario: Live event arrives during catch-up

- **WHEN** a subscriber's historical replay (`net-history-fetch`) is still in progress
- **AND** a live `Event.SEGMENT_COMMITTED` record for a matching topic arrives and passes dedup
- **THEN** the event SHALL be held via the subscriber's existing delay stack and delivered after `traceStarted` is set to `true`, in the same order it would be under the local (non-distributed) engine
