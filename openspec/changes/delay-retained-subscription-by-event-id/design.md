## Context

The system supports retained messages where a subscriber can receive the latest state of a topic upon subscription. However, there is no synchronization between publishing a message and subscribing for its retained state. If a client publishes and then immediately subscribes, the subscription might be processed before the storage has finished committing the publish, leading to the client receiving stale data.

## Goals / Non-Goals

**Goals:**
- Provide a way for subscribers to wait for a specific event to be committed to retained storage before receiving retained state.
- Ensure consistency in "publish-then-subscribe" workflows.
- Support the two completed local engines first: in-memory and SQLite.
- Use one shared test suite that runs the same retained-sync cases against both local engines.
- Capture network/distributed requirements and unresolved design questions without pretending they are already implementable.

**Non-Goals:**
- Waiting for events on topics other than the subscribed topic (though the mechanism might allow it, it's not the primary goal).
- Providing a generic "wait for event" API to clients (it's integrated into SUBSCRIBE).
- Blocking normal live event delivery for the subscription while retained replay is waiting.
- Completing network/distributed mode support before the storage-to-entry commit signal is defined.

## Decisions

### 1. Wait on retained-storage commit, not event assignment
The wait condition is "the retained key-value storage has committed an event ID greater than or equal to `after_event_id`" for engines where event IDs are monotonic and comparable.

**Rationale:**
The race is between subscription-time retained lookup and retained key-value commit. Resolving a waiter when an event ID is merely assigned or when history is saved is too early for retained publishes because `DbEngine.doPush` assigns/saves the event before `updateKvFromActor` completes.

### 2. Local engine scope
The first implementation covers:

- `BaseEngine` with `MemKeyValueStorage`.
- `DbEngine` with SQLite key-value storage.

Both engines must expose comparable local retained event IDs and must pass the same retained-sync test cases. The in-memory engine will generate local monotonic retained event IDs for retained publishes because it currently stores `null` event IDs unless the actor already has one.

**Rationale:**
The in-memory engine is the simplest complete engine and should define the baseline behavior. SQLite then verifies the same contract across the persistent implementation. Network mode is unfinished and should not block the local engine contract.

### 3. Persisted events must have event IDs before storage writes
An event ID is optional only for events that will not be stored anywhere. If an event is going to be written to retained key-value storage, event history storage, or both, the engine must assign an event ID before the storage write starts.

Retained key-value storage must not generate a replacement event ID and must not accept `null` as the stored retained event ID for a retained event. The event ID stored with the retained row is the same event ID that identifies the publish in the engine. Event history uses the same rule: history rows are persisted only after the event ID has been assigned.

For local engines:

- `MemEngine.saveInboundHistory(actor)` assigns the local event ID before `BaseEngine.doPush()` updates retained KV storage.
- `DbEngine.saveHistory(actor)` assigns the local event ID before `DbEngine.doPush()` updates retained KV storage.

**Rationale:**
The delayed retained replay feature waits for a storage-visible event ID. If persisted events could be stored without IDs, subscribers would not have a stable position to wait for, retained replay could return `null` qids, and history/KV synchronization would become ambiguous. Event ID ownership belongs to the engine publish path, not to individual storage backends.

### 4. Engine-level Event ID Tracking
`BaseEngine` will be extended with a committed retained event marker such as `currentRetainedEventId: string | null` and a method such as `waitForRetainedEventId(eventId: string, owner?: ActorTrace): Promise<void>`.

**Rationale:**
The engine coordinates subscriptions and storage access. Tracking the last committed retained event at this level lets `doTrace` delay retained lookup without exposing a new client API.

### 5. Event Waiter Management
`BaseEngine` will maintain pending waiters keyed by target event ID. Each waiter includes a promise resolver, rejecter, owning subscription/session identity, and a timeout handle.

**Rationale:**
Waiters need cleanup when a subscription is removed, a session closes, or the target event never arrives. An unbounded promise list would leak memory and could be triggered by invalid client input.

### 6. Resolving Waiters
Whenever retained storage commits an event ID, the engine will update `currentRetainedEventId` and resolve waiters whose target `eventId` is less than or equal to the committed ID.

For `DbEngine`, this happens after `updateKvFromActor(actor)` resolves for retained publishes. Non-retained publishes must not advance the retained-storage marker because they do not make retained lookup fresher.

For the in-memory engine, this happens after `MemKeyValueStorage.setKeyActor(actor)` has updated `_keyDb` for the retained publish. The already-assigned local event ID is stored with the retained row so retained replay can return the same ID in `qid`.

**Rationale:**
The freshness guarantee is specifically about retained state. Resolving only after retained storage commit keeps the implementation aligned with the observable state returned by `getKey`.

### 7. Integration in `doTrace`
The `BaseEngine.doTrace` method will delay the retained-state lookup when all of the following are true:

- `after_event_id` is present.
- `retained` or `retainedState` is requested.
- The target event ID is not already reached by the engine's committed retained event marker.

The subscription is still registered immediately and `SUBSCRIBED` is sent immediately. Live events may be delivered while retained replay is waiting. Only retained replay is held back.

**Rationale:**
This is the most surgical place to insert the delay, as `doTrace` already manages the initial subscription lifecycle including history and retained state.

### 8. Shared tests for local engines
The retained-sync tests will be organized so each scenario runs against both local engine configurations. The test matrix must include the in-memory engine and SQLite `DbEngine`; network mode is excluded from this test matrix until its capabilities are implemented.

**Rationale:**
Running the same tests against both local engines keeps the feature contract engine-neutral and prevents SQLite-specific behavior from becoming the accidental definition.

### 9. Interaction with history replay
If both `after` and `after_event_id` are provided, history replay follows the existing `after` behavior and retained replay waits independently on `after_event_id`. This change does not reorder history replay relative to live events beyond the current `traceStarted` and delay-stack behavior.

**Rationale:**
`after` and `after_event_id` solve different problems: event history replay and retained key-value freshness. Coupling them would broaden the change and risk changing existing subscription semantics.

### 10. Subscription stage model
Subscription behavior is defined at the Hyper API level because the Hyper API contains the router's full functionality. WAMP and MQTT gates translate into that API.

The subscription lifecycle has a common creation stage, then separate catch-up variants:

- retained KV catch-up: optionally wait for `after_event_id`, fetch current retained values from key-value storage, then continue with live events
- history catch-up: fetch event history after `after`, buffer matching live events while history is loading, flush the buffer, then continue with live events

These variants must not be collapsed into one implementation path. Retained KV is a snapshot source and history is an ordered stream source. `after_event_id` describes KV visibility; `after` describes a history stream position.

See [subscription-stages.md](subscription-stages.md) for the detailed Hyper API behavior description.

**Rationale:**
The current `doTrace` flow already has different state for history replay (`traceStarted` and `delayStack`) and retained lookup (`getKey`). Making this separation explicit prevents the delayed-retained implementation from accidentally treating retained KV replay as history replay.

### 11. Invalid and unreachable IDs
Invalid `after_event_id` values are rejected at subscription time with a WAMP error. Valid but unreachable IDs wait until a bounded timeout. On timeout, the retained replay is skipped and the subscription remains active for live events, unless a later implementation chooses to surface a subscription error before finalization.

**Rationale:**
This prevents permanent memory growth while preserving the already-created subscription. The exact timeout value should be configurable with a conservative default.

## Open Issues

### Network mode commit visibility
The existing masterfree flow separates entry-side acknowledgement from storage-side history commit. `NetEngine.advance_segment_resolved` confirms local actors, while `storage.commit_segment` writes history on storage nodes. The change still needs a concrete signal from storage back to the serving engine that the event ID is locally committed and visible to retained lookup.

### Network retained key-value update
The current storage flow clearly saves event history, but the proposal needs to confirm where retained key-value state is updated for network events. Waiting for history commit alone is not enough if retained lookup reads from a different state store.

### Network event ID comparability
The local engines will use comparable local retained event IDs. Network/distributed segment IDs may need a parser/comparator instead of raw string comparison.

## Risks / Trade-offs

- **[Risk] Memory Accumulation**: If a client provides a very large `after_event_id` that is never reached, the waiter might stay in memory indefinitely.
  - **Mitigation**: Add timeout and cleanup waiters on unsubscribe/session cleanup.
- **[Trade-off] Performance**: Checking waiters on every event push adds a small overhead.
  - **Mitigation**: Use a sorted structure or only check when there are active waiters to minimize impact.
- **[Trade-off] Immediate subscription, delayed retained replay**: Clients can see live events before delayed retained replay.
  - **Mitigation**: Document this ordering explicitly and cover it in tests.
