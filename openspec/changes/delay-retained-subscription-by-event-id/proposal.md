## Why

When a client publishes an event and immediately subscribes to the same topic with the `retained` option, there is a potential race condition where the subscription might be processed and the retained state fetched before the previous publish has been fully committed to the key-value storage. This results in the client receiving stale data. Providing a way to wait for a specific event ID ensures that the client receives the most up-to-date state reflecting their own or others' recent changes.

## What Changes

- **SUBSCRIBE options**: A new optional attribute `after` is added to the `SUBSCRIBE` message options.
- **Subscription Logic**: The realm engine will detect the `after` option and, if `retained` or `retainedState` is also requested, delay only the retained-state lookup until the target event ID is known to be committed to retained storage.
- **Engine Capabilities**: The base engine will be extended with a bounded mechanism to track committed retained-storage event IDs and wait for specific IDs.
- **Initial Scope**: The first implementation targets the two completed local engines: the in-memory engine and `DbEngine` with SQLite key-value storage. Both engines will implement the same `after` behavior and will be covered by the same test cases.

## Capabilities

### New Capabilities
- `retained-state-event-sync`: Provides the ability to synchronize the retrieval of retained state with the processing of a specific event ID to ensure data consistency.

### Modified Capabilities
- `distributed-mode`: Distributed behavior is documented as dependent on the local KV projection watermark defined by `kv-storage-module-registration`. Distributed `after` support remains unavailable until the projection catch-up path is implemented and retained lookup can observe that watermark.

## Impact

- **API**: WAMP `SUBSCRIBE` options will accept `after`.
- **Core**: `lib/realm.ts` and `lib/wamp/gate.ts` will be updated to handle the new option.
- **Engines**: The in-memory engine and `DbEngine` will support event ID tracking and waiting after retained storage commits. The network engine will support `after` only after it can wait for local Key-Value projection updates from committed segments.
- **Storage**: Retained state lookup will be delayed when the sync option is present; the subscription itself remains active unless the design is changed later.

## Open Issues

- **Network retained state path**: Confirm that retained key-value lookup in network mode reads from the local KV projection updated from committed segments.
- **Network event ID comparator**: Align distributed retained `after` comparisons with the string-comparable event/segment watermark defined by `kv-storage-module-registration`.

## Open Questions

### Distributed Retained Sync Dependency

Distributed retained subscription delay still depends on visibility into the local KV projection watermark.

- Which table and field does retained lookup check for the local projection watermark?
- Does retained lookup require all projections for a realm to reach `after`, or only projections matching the subscription URI?
- What happens when a matching projection status is `inactive`, `refreshing`, or `failed`?
- If no projection is registered for the subscription URI, does distributed `after` fail, time out, or fall back to immediate retained lookup?
