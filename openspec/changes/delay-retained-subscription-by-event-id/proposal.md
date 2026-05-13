## Why

When a client publishes an event and immediately subscribes to the same topic with the `retained` option, there is a potential race condition where the subscription might be processed and the retained state fetched before the previous publish has been fully committed to the key-value storage. This results in the client receiving stale data. Providing a way to wait for a specific event ID ensures that the client receives the most up-to-date state reflecting their own or others' recent changes.

## What Changes

- **SUBSCRIBE options**: A new optional attribute `after_event_id` is added to the `SUBSCRIBE` message options.
- **Subscription Logic**: The realm engine will detect the `after_event_id` option and, if `retained` is also requested, delay the retrieval of the retained state from storage until the event with the specified ID has been processed.
- **Engine Capabilities**: The base engine will be extended with a mechanism to track and wait for specific event IDs.

## Capabilities

### New Capabilities
- `retained-state-event-sync`: Provides the ability to synchronize the retrieval of retained state with the processing of a specific event ID to ensure data consistency.

### Modified Capabilities
- `distributed-mode`: The distributed sharding and synchronization logic will be updated to ensure that `after_event_id` correctly waits for the event to be committed locally or globally as required.

## Impact

- **API**: WAMP `SUBSCRIBE` options will accept `after_event_id`.
- **Core**: `lib/realm.ts` and `lib/wamp/gate.ts` will be updated to handle the new option.
- **Engines**: `DbEngine` and other engine implementations will need to support event ID tracking and waiting.
- **Storage**: Key-Value storage interactions will be delayed when the sync option is present.
