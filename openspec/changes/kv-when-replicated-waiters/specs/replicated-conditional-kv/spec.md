# Spec Delta

## Purpose

Makes conditional KV updates (`when`, `watch`: wait-for-lock) work when KV state lives on remote replicas: every replica decides the outcome of each conditional request deterministically from committed history, and reports the outcome to the entry node that owns the client request.

## ADDED Requirements

### Requirement: Conditional request as committed history
In distributed mode, a publish carrying `when` SHALL be committed to history as a conditional request through the normal segment pipeline, carrying the owning entry id, actor id (advance id), session id, topic, payload and options. Committing the request SHALL NOT itself acknowledge the publish to the client.

#### Scenario: Conditional publish is committed without acknowledgment
- **WHEN** a client publishes to a KV topic with `when` through an entry node
- **AND** the segment holding that publish is resolved and committed
- **THEN** the committed record SHALL carry the entry id, advance id, session id, topic, data and `when`/`watch` options
- **AND** the entry SHALL NOT acknowledge the publish at segment resolution

#### Scenario: Plain publish acknowledgment is unchanged
- **WHEN** a client publishes to a KV topic without `when`
- **THEN** the entry SHALL acknowledge the publish at segment resolution as before

### Requirement: Deterministic replicated evaluation
Every KV replica SHALL evaluate committed conditional requests and the writes that affect them in ascending eventId order across all shards, so that all replicas reach the same outcome for each request. The outcome SHALL be one of `applied`, `parked` or `rejected`.

#### Scenario: Condition met
- **WHEN** a replica evaluates a committed conditional request whose `when` matches the key's current value
- **THEN** the replica SHALL apply the update at the request's eventId with outcome `applied`

#### Scenario: Condition not met without watch
- **WHEN** a replica evaluates a committed conditional request whose `when` does not match and `watch` is not set
- **THEN** the replica SHALL leave the key unchanged with outcome `rejected`

#### Scenario: Condition not met with watch
- **WHEN** a replica evaluates a committed conditional request whose `when` does not match and `watch` is true
- **THEN** the replica SHALL store a waiter record with outcome `parked`

#### Scenario: Replicas agree regardless of arrival order
- **GIVEN** two KV replicas receive the same committed events from different shards in different arrival orders
- **WHEN** both have evaluated through the same eventId
- **THEN** both SHALL hold the same KV value, the same waiter records and the same outcome for every request

### Requirement: Waiter record model
A parked request SHALL be held as a data record identifying the topic, condition, payload, options, entry id, session id, actor id and request eventId. Parked requests SHALL NOT be held as references to live client-request objects, so any replica can resolve them without the client's session being local.

#### Scenario: Waiter survives key deletion
- **GIVEN** a parked waiter on key K
- **WHEN** another write merges K's value to empty and the key is removed
- **THEN** the waiter record SHALL remain and SHALL still be evaluated against later writes to K

#### Scenario: Waiter addressable by ids
- **WHEN** a waiter is parked
- **THEN** its record SHALL include the entry id, session id and actor id needed to address the resolution to the owning client request

### Requirement: Waiter firing order
When a write at eventId T changes a key that has parked waiters, the replica SHALL fire waiters one at a time in the order they were parked (by request eventId), re-evaluating each against the value produced by the previous one, and SHALL fire only waiters whose `when` matches.

#### Scenario: Mutex behavior
- **GIVEN** two waiters parked on key K with the same condition
- **WHEN** a write at T makes the condition true
- **THEN** only the earlier-parked waiter SHALL fire if its effect makes the condition false again
- **AND** the later waiter SHALL remain parked

#### Scenario: Chained firing
- **GIVEN** waiters W1 and W2 parked on key K, where W1's effect satisfies W2's condition
- **WHEN** a write at T satisfies W1's condition
- **THEN** W1 and then W2 SHALL fire, both triggered by T

### Requirement: Derived event ids for fired waiters
The effect of the n-th waiter fired by trigger event T SHALL have eventId `T` followed by the length-prefixed offset encoding of n. Derived ids SHALL compare greater than T and less than every real eventId greater than T, and SHALL never equal a real eventId.

#### Scenario: Derived id ordering
- **GIVEN** trigger event T and the next real event U
- **WHEN** two waiters fire at T
- **THEN** their effects SHALL have ids D1 and D2 with `T < D1 < D2 < U` in string order

#### Scenario: Resuming after a derived id
- **WHEN** a consumer resumes with `after` equal to a derived id D1 at trigger T
- **THEN** it SHALL receive D2 (if any) and then real events greater than T, and SHALL NOT receive T or D1 again

### Requirement: Resolution reported to owning entry
For every conditional request whose outcome is `applied` or `rejected`, or that later fires, each KV replica SHALL send `KV_WHEN_RESOLVED` with the entry id, actor id, outcome and the effect eventId (when applied) to the owning entry. The entry SHALL act on the first resolution for an actor id and ignore duplicates from other replicas.

#### Scenario: Confirm on applied
- **WHEN** the entry receives `KV_WHEN_RESOLVED` with outcome `applied` for an actor id it holds
- **THEN** the entry SHALL acknowledge the client publish

#### Scenario: Reject on rejected
- **WHEN** the entry receives `KV_WHEN_RESOLVED` with outcome `rejected` for an actor id it holds
- **THEN** the entry SHALL reject the client publish with an invalid-payload error

#### Scenario: Parked request stays pending
- **WHEN** a request is parked
- **THEN** the client publish SHALL remain unacknowledged until a later `KV_WHEN_RESOLVED` reports it fired

#### Scenario: Duplicate resolution from replicas
- **GIVEN** N KV replicas resolve the same request
- **WHEN** the entry receives N `KV_WHEN_RESOLVED` messages for one actor id
- **THEN** the client SHALL be acknowledged or rejected exactly once

#### Scenario: Resolution for a closed session
- **WHEN** the entry receives `KV_WHEN_RESOLVED` for an actor id whose session is no longer connected
- **THEN** the entry SHALL discard it without error

### Requirement: Effective events delivered to subscribers
Subscribers SHALL receive the effects of conditional requests, not the requests. Entries SHALL NOT live-dispatch committed conditional requests to subscribers. KV replicas SHALL deliver each effect (with its real or derived eventId) to entries, and entries SHALL deliver each effect eventId to subscribers at most once.

#### Scenario: Request not dispatched
- **WHEN** a conditional request is committed
- **THEN** subscribers of its topic SHALL NOT receive the request as an event

#### Scenario: Applied effect dispatched once
- **GIVEN** N KV replicas apply the same conditional request
- **WHEN** they deliver the effect to the entry
- **THEN** each subscriber of the topic SHALL receive the effect exactly once with its effect eventId

#### Scenario: Rejected or parked request produces no event
- **WHEN** a conditional request is rejected or parked
- **THEN** subscribers SHALL receive no event for it

### Requirement: Pre-commit rejection without a connected owner
An entry SHALL track the storage patterns announced by each connected KV node and SHALL forget a node's patterns when it disconnects. Before committing a `when` publish, the entry SHALL reject it with a retryable error code, distinct from the condition-not-met error, when no connected KV node owns its realm and topic. After commit, the entry SHALL NOT reject a conditional publish on its own.

#### Scenario: No connected owner
- **GIVEN** no connected KV node has announced a pattern owning `realm:topic`
- **WHEN** a client publishes to `realm:topic` with `when`
- **THEN** the entry SHALL reject it with the retryable no-owner error
- **AND** the request SHALL NOT be committed to history

#### Scenario: Owner forgotten on disconnect
- **GIVEN** KV node K announced a pattern owning `realm:topic` and is the only owner
- **WHEN** K disconnects from the entry and a client then publishes to `realm:topic` with `when`
- **THEN** the entry SHALL reject the publish with the retryable no-owner error

#### Scenario: Owner reconnects
- **WHEN** K reconnects and announces its patterns again
- **THEN** later `when` publishes to `realm:topic` SHALL be committed

#### Scenario: Owner lost after commit
- **GIVEN** a `when` publish was committed while K was connected
- **WHEN** K disconnects before resolving it
- **THEN** the entry SHALL keep the publish pending until a replica reports its outcome

### Requirement: Requests after session leave
KV replicas SHALL reject any conditional request from an entry and session whose committed `SESSION_LEAVE` precedes the request in event order, and SHALL NOT park it or apply it.

#### Scenario: In-flight request after forced leave
- **GIVEN** a committed `SESSION_LEAVE` for session S of entry E at eventId L
- **WHEN** a conditional request from (E, S) is committed with an eventId greater than L
- **THEN** every replica SHALL evaluate it as `rejected` and leave the key unchanged

### Requirement: Local engine parity
Local engines (in-memory and single SQLite) SHALL follow the same waiter record model, firing order and acknowledgment outcomes, with local processing order standing in for eventId order and resolution delivered to the client request through a local lookup by actor id.

#### Scenario: Chained waiter acknowledged with its own request
- **GIVEN** waiters W1 and W2 chained on key K in the in-memory engine
- **WHEN** a write fires both
- **THEN** W1 and W2 SHALL each be acknowledged against their own client request

#### Scenario: Same outcomes in local and distributed mode
- **WHEN** the same sequence of conditional and plain publishes is run against the in-memory engine and against the distributed engine
- **THEN** the final KV values and the acknowledge/reject outcome of every publish SHALL be the same
