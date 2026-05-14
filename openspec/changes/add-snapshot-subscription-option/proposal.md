## Why

Clients often need to retrieve the current state (retained values or history) without the intention of receiving further live updates. Currently, this requires manually subscribing and then immediately unsubscribing after data is received. A dedicated `snapshot` option simplifies this pattern, reduces boilerplate code for clients, and ensures that server-side subscription resources are released immediately after the data transfer is complete.

## What Changes

- **SUBSCRIBE Options**: A new optional boolean attribute `snapshot` is added to the `SUBSCRIBE` message options.
- **Subscription Lifecycle**: If `snapshot` is true, the subscription will automatically be removed by the router after all initial data (retained state and/or history) has been sent to the client.
- **Hyper API Promise Resolution**: The `HyperClient.subscribe` method will resolve its promise only after the snapshot data has been successfully fetched and dispatched, ensuring the client knows when the operation is complete.
- **WAMP/MQTT Integration**: Gateway protocols will be updated to accept and pass the `snapshot` option to the realm engine. Both WAMP and MQTT gateways will support this attribute to allow point-in-time data retrieval.

## Capabilities

### New Capabilities
- `snapshot-subscription`: Provides a mechanism for point-in-time data retrieval from retained and history storage with automatic subscription cleanup.

### Modified Capabilities
- (None)

## Impact

- **API**: `HyperClient.subscribe` and protocol gates (WAMP/MQTT) will accept the `snapshot` option.
- **Core**: `lib/realm.ts` will be updated to handle automatic unsubscription after initial replay.
- **Hyper Client**: `lib/hyper/client.ts` will be modified to coordinate promise resolution with the completion of data replay.
