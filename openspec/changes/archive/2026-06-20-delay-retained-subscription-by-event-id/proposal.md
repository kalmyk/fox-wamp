## Why

When a client publishes an event and immediately subscribes to the same topic with the `retained` option, there is a potential race condition where the subscription might be processed and the retained state fetched before the previous publish has been fully committed to the key-value storage. This results in the client receiving stale data. Providing a way to wait for a specific event ID ensures that the client receives the most up-to-date state reflecting their own or others' recent changes.

## What Changes

- **SUBSCRIBE options**: A new optional attribute `after` is added to the `SUBSCRIBE` message options.
- **Subscription Logic**: The realm engine will detect the `after` option and, if `retained` or `retainedState` is also requested, delay only the retained-state lookup until the target event ID is known to be committed to retained storage.
- **Operation Semantics**: The subscribe operation is acknowledged immediately after the live listener is registered. Live event delivery is not blocked by delayed retained replay. Retained replay runs as a separate catch-up operation that waits for KV visibility and is cancelled on unsubscribe/session cleanup or skipped on timeout.
- **Engine Capabilities**: The base engine will be extended with a bounded mechanism to track committed retained-storage event IDs and wait for specific IDs.
- **Initial Scope**: The first implementation targets the two completed local engines: the in-memory engine and `DbEngine` with SQLite key-value storage. Both engines will implement the same `after` behavior and will be covered by the same test cases.
- **Distributed Scope**: Distributed synchronized retained replay remains gated until retained lookup can observe the same local KV projection watermark that backs the retained rows it will read.

## Capabilities

### New Capabilities
- `retained-state-event-sync`: **ADDED** requirements for accepting `options.after`, delaying retained replay until retained KV visibility reaches the requested event ID, engine retained-event tracking, and shared local-engine behavior across the in-memory engine and SQLite `DbEngine`.

### Modified Capabilities
- `distributed-mode`: **ADDED** requirement for distributed retained synchronization to wait on the local KV projection watermark before retained state is fetched. Distributed `after` support remains unavailable until retained lookup can observe that watermark.

## Impact

- **API**: WAMP `SUBSCRIBE` options will accept `after`.
- **Core**: `lib/realm.ts` and `lib/wamp/gate.ts` will be updated to handle the new option.
- **Engines**: The in-memory engine and `DbEngine` will support event ID tracking and waiting after retained storage commits. The network engine will support `after` only after it can wait for local Key-Value projection updates from committed segments.
- **Storage**: Retained state lookup will be delayed when the sync option is present; the subscription itself remains active unless the design is changed later.

## Operational Contract

### Local Engines

- `after` is accepted on WAMP `SUBSCRIBE` options when it is a valid event ID string.
- If `after` is provided without `retained` or `retainedState`, the subscription is accepted and live event delivery is not delayed.
- If retained replay is requested with `after`, the subscription is registered and acknowledged immediately, then retained replay waits until the engine's retained-storage marker reaches `after`.
- Retained waiters resolve only after the retained KV write is visible to retained lookup. Event ID assignment or history persistence alone is not sufficient.
- Non-retained publishes do not advance the retained-storage marker.
- A valid but unreachable `after` waits only until the configured timeout; after timeout, retained replay is skipped and the subscription remains active for live events.
- Unsubscribe or session cleanup cancels any pending retained replay waiter.

### Distributed Engines

- Distributed `after` waits on `kv_storage_${realmName}.current_position` from the local KV projection, not on `ADVANCE_SEGMENT_RESOLVED` alone.
- Retained lookup must read retained rows from the same local KV projection whose `current_position` watermark is used for the wait.
- Event and segment watermarks are compared as strings, following `kv-storage-module-registration`; implementations must not parse distributed event IDs for ordering.
- Before the serving node can observe the required local projection watermark, synchronized distributed retained replay is rejected as unsupported.

## Open Questions

### Distributed Retained Sync Dependency

Distributed retained subscription delay still depends on visibility into the local KV projection watermark.

- Does retained lookup require all projections matching the subscription URI to reach `after`, or is one matching projection sufficient for the requested retained result?
- What happens when a matching projection status is `inactive`, `refreshing`, or `failed`?
- If no projection is registered for the subscription URI, does distributed `after` fail immediately as unsupported or wait until timeout?
