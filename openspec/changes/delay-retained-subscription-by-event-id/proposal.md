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
- `distributed-mode`: Distributed behavior is documented as an open issue for this change. The current masterfree code does not expose a clear entry-engine signal that a remote event is both locally committed and visible through retained key-value lookup.

## Impact

- **API**: WAMP `SUBSCRIBE` options will accept `after`.
- **Core**: `lib/realm.ts` and `lib/wamp/gate.ts` will be updated to handle the new option.
- **Engines**: The in-memory engine and `DbEngine` will support event ID tracking and waiting after retained storage commits. The network engine will support `after` by waiting for local Key-Value projection updates from resolved segments.
- **Storage**: Retained state lookup will be delayed when the sync option is present; the subscription itself remains active unless the design is changed later.

## Open Issues

- **Network retained state path**: Confirm whether retained key-value state is updated in network mode for the same events as history, and which component owns that update.
- **Network event ID comparator**: Define whether network/distributed event IDs can use the same comparator as local engines or require a network-specific parser.
