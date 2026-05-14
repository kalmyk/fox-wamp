# Hyper API Subscription Stages

This file describes subscription behavior at the Hyper API level. The Hyper API is the internal API that contains the full router functionality. WAMP and MQTT gateways translate protocol messages into this API, but the subscription lifecycle is defined here first.

## Scope

The delayed subscription proposal affects how `HyperClient.subscribe()` / realm `cmdTrace` handles initial delivery after a subscription is created.

The API has three delivery sources:

- live incoming events matched by the active listener
- retained key-value state fetched from storage
- event history records fetched from history storage

These sources are not interchangeable. Retained KV catch-up and history catch-up describe different starting positions and must not be combined into one replay algorithm.

## Common First Stage

Every subscription starts the same way:

1. The subscription actor is created.
2. The actor is registered in the topic matcher.
3. The caller receives the subscribe acknowledgement.
4. The subscription can now observe matching incoming live events.

After this point, initial catch-up behavior depends on subscription options.

## Variant A: Retained KV Catch-Up

This variant is used when the subscription requests `retained` or `retainedState`.

The retained source is key-value storage. The starting position is the latest retained value visible in KV storage, not the event history table.

Without `after_event_id`:

1. Fetch last retained values from KV storage.
2. Send matching retained rows to the subscriber.
3. Continue listening to incoming live events.

With `after_event_id`:

1. Register the live listener immediately.
2. Wait until retained KV storage has committed an event ID greater than or equal to `after_event_id`.
3. Fetch last retained values from KV storage.
4. Send matching retained rows to the subscriber.
5. Continue listening to incoming live events.

Incoming live events may arrive while the retained KV fetch is waiting. The wait only delays the retained KV fetch, because the consistency problem is whether KV already reflects the target event.

## Variant B: History Catch-Up

This variant is used when the subscription requests event history with `after`.

The history source is event history storage. The starting position is the supplied history event ID.

1. Register the live listener immediately.
2. Buffer matching incoming live events while history is being fetched.
3. Fetch history records after the supplied `after` position.
4. Send matching history records to the subscriber.
5. Mark history catch-up as complete.
6. Flush buffered live events.
7. Continue listening to incoming live events directly.

The buffer is necessary so history records are delivered before live events that arrived after subscription creation.

## Why The Variants Stay Separate

Retained KV catch-up and history catch-up cannot be represented as a single ordered replay:

- KV retained state is a snapshot of current keys. It intentionally collapses earlier writes.
- History records are an ordered stream. They preserve each stored event after a position.
- `after_event_id` waits for KV visibility of a retained write.
- `after` asks history storage for records after a stream position.
- A retained KV row's event ID identifies the write that produced the visible state, while a history event ID identifies a stream record.

If both `after` and `after_event_id` are present, each option controls its own source. The history path fetches and flushes history-buffered live events according to `after`. The retained path waits for KV visibility according to `after_event_id` before reading KV. The implementation must avoid claiming a total ordering between these two independent catch-up sources unless a later design explicitly defines one.

## Implementation Shape

At the realm engine level, the subscription actor needs separate state for each initial source:

- `traceStarted` and `delayStack` belong to history catch-up.
- retained KV waiting belongs to a retained replay task keyed by `after_event_id`.
- live listener registration is common and happens before either catch-up source finishes.

For the `after_event_id` change, the retained task should be:

1. skipped when neither `retained` nor `retainedState` is requested
2. immediate when the committed retained event marker already reaches the target ID
3. pending when the marker has not reached the target ID
4. cancelled when the subscription/session is removed
5. timed out when the target ID remains unreachable

The engine must resolve retained waiters only after the retained KV write is visible to `getKey()`. History commit or event ID assignment alone is not enough.
