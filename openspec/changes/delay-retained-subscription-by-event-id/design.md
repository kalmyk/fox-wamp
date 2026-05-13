## Context

The system supports retained messages where a subscriber can receive the latest state of a topic upon subscription. However, there is no synchronization between publishing a message and subscribing for its retained state. If a client publishes and then immediately subscribes, the subscription might be processed before the storage has finished committing the publish, leading to the client receiving stale data.

## Goals / Non-Goals

**Goals:**
- Provide a way for subscribers to wait for a specific event to be processed before receiving retained state.
- Ensure consistency in "publish-then-subscribe" workflows.
- Support both standalone and distributed modes.

**Non-Goals:**
- Waiting for events on topics other than the subscribed topic (though the mechanism might allow it, it's not the primary goal).
- Providing a generic "wait for event" API to clients (it's integrated into SUBSCRIBE).

## Decisions

### 1. Engine-level Event ID Tracking
`BaseEngine` will be extended with a `currentEventId: string | null` property and a `waitForEventId(eventId: string): Promise<void>` method.

**Rationale:**
The engine is responsible for the message lifecycle and interacting with storage. Tracking the "last seen" event ID at this level allows all sub-components (like `doTrace`) to synchronize with the message flow.

### 2. Event Waiter Management
`BaseEngine` will maintain a list of pending waiters. Each waiter consists of a target `eventId` and a promise resolver.

**Rationale:**
Using promises makes the asynchronous waiting logic clean and easy to integrate into existing `async/await` flows in `lib/realm.ts`.

### 3. Resolving Waiters
Whenever a new event ID is assigned and processed (e.g., in `DbEngine.doPush` or during distributed segment resolution), the engine will check for and resolve any waiters whose target `eventId` is less than or equal to the new current ID.

**Rationale:**
Since IDs are sortable (e.g., `YYMMDDHHMM...`), we can efficiently resolve all waiters that have been "passed" by the current event stream.

### 4. Integration in `doTrace`
The `BaseEngine.doTrace` method will be modified to wrap the `retainedState` fetching logic in a call to `waitForEventId` if the subscription options contain `after_event_id`.

**Rationale:**
This is the most surgical place to insert the delay, as `doTrace` already manages the initial subscription lifecycle including history and retained state.

## Risks / Trade-offs

- **[Risk] Memory Accumulation**: If a client provides a very large `after_event_id` that is never reached, the waiter might stay in memory indefinitely.
  - **Mitigation**: For the initial implementation, we will rely on correct client behavior. Future enhancements could include a timeout for waiters.
- **[Trade-off] Performance**: Checking waiters on every event push adds a small overhead.
  - **Mitigation**: Use a sorted structure or only check when there are active waiters to minimize impact.
