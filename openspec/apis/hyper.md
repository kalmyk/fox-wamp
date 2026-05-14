# Hyper API (Internal Protocol)

The Hyper API (a.k.a. HyperNet, Hyper protocol) is the internal command/event API used by the router core and for inter-node communication in distributed (masterfree) mode. It exposes the router's full functionality and is the canonical layer that WAMP and MQTT gates translate into.

Purpose:

- Provide a stable, typed surface for core router operations (publish, subscribe, retained storage operations, RPC dispatch, synchronization primitives).
- Define event enums and BODY_* TypeScript types for publish payload shapes used across the system. These types are declared in `lib/masterfree/hyper.h.ts` and should be referenced by code and documentation.

Important concepts:

- Event: A named message that can be published/subscribed. Events are enumerated in `Event` enum.
- BODY_* types: Typed shapes for event payloads. Use these for compile-time checking and documentation.
- Commands: Gate-translated instructions such as `CMD_SUBSCRIBE`, `CMD_PUBLISH`, `CMD_CALL`, etc. Commands carry metadata like `qid`, `sessionId`, `options`, and `tag`/`shardTag` for distributed routing.
- Advance / Segments: In masterfree distributed mode, messages pass through multi-stage lifecycle using advance IDs and segments for ordering and sharding.

Files of interest:

- `lib/masterfree/hyper.h.ts` — canonical TypeScript types and enums for events and bodies.
- `lib/masterfree/netengine.ts` — node-to-node communication and handshake logic.
- `lib/masterfree/synchronizer.ts` — synchronization state machine and handlers for Hyper messages.

Design notes:

- The OpenSpec directory contains changes and specs that modify or extend the Hyper API. When making API-level changes, add or update corresponding OpenSpec artifacts under `openspec/changes/<change-name>/` so the change is tracked.

Supported Command Options / Attributes (internal)

These are the canonical internal command/event options used by the Hyper API and by engine implementations. Protocol gates translate protocol-level options into these internal names.

- retain / retained (boolean)
  - Keep value in key-value storage. Used by ActorPush and KeyValue storage methods (`updateKvFromActor`).

- ack / acknowledge (boolean)
  - Request acknowledgement on publish; publisher will receive assigned event id via published confirmation.

- exclude_me (boolean)
  - When true, the publisher will not receive the published event via matched subscriptions on the same session.

- after (string)
  - Specifies a synchronization point for either history replay or retained snapshot synchronization.
  - History replay: Fetches ordered history stream since the given ID.
  - Retained sync: Retained-storage visibility marker; engines supporting retained event synchronization expose `supportsRetainedEventSync` and provide `waitForRetainedEventId` and `resolveRetainedEventWaiters` behavior.

- when (object|null)
  - Conditional predicate used by key-value storage to gate a publish (publish only if storage matches the `when` predicate).

- watch (boolean)
  - Used with `when`. If true, the publish waits until the `when` condition is met; combines with acknowledgement semantics to provide synchronization primitives.

- will (any)
  - A key-value 'will' value applied on unexpected session disconnect.

- trace / traceStarted / keepTraceFlag (boolean)
  - Internal tracing and subscription lifecycle flags used for history/retained interplay and whether to keep trace options in outgoing events.

- headers / hdr (object)
  - Arbitrary metadata passed with commands and events.

- reducer (boolean) and simultaneousTaskLimit (integer)
  - Used by registration commands to indicate reducer behavior and concurrency limits for RPC handlers.

Engine Integration Notes:
- Engines must expose `supportsRetainedEventSync` to accept `after` for retained synchronization and must implement `waitForRetainedEventId` and `resolveRetainedEventWaiters`. See `lib/realm.ts` and `lib/masterfree/*` for implementations and tasks that update the behavior.
- The canonical TypeScript BODY_* types in `lib/masterfree/hyper.h.ts` define the shapes for event payloads and should be used as the source of truth for documentation and type generation.

Examples (HyperClient / internal API)

Subscribe for retained values:

```javascript
const api = realm.api()
await api.subscribe('key.value.1', (body, opt) => {
  console.log('received', body, opt)
}, { retained: true })
```

Publish with acknowledge and retain via the Hyper API:

```javascript
const api = realm.api()
const eventId = await api.publish('key.value.1', { status: 'ready' }, { acknowledge: true, retain: true })
```

Conditional publish with watch (synchronization usage):

```javascript
await api.publish('myapp.resource', { pid: process.pid }, { acknowledge: true, retain: true, when: null, watch: true, will: null })
```
