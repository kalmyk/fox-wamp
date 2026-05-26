# WAMP API (Overview)

This document describes how FOX-WAMP exposes and translates WAMP V2 messages into the router's internal API.

Key points:

- FOX-WAMP implements WAMP V2 Basic Profile for Pub/Sub and RPC.
- WAMP messages received by entry nodes (WAMP gates) are validated and translated into the internal Hyper API commands and events. Responses and events from the Hyper API are translated back into WAMP protocol messages.
- Topic translation: WAMP topic names use the canonical dotted FOX form, such as `app.topic.name`. They are parsed with the same dotted parser used by the Hyper/FOX API. MQTT slash topics are converted at the MQTT gate into the same internal topic array.

Supported message types and behaviours (non-exhaustive):

- HELLO / WELCOME: Session establishment and realm negotiation. The server will send CHALLENGE for authentication methods that require it, and WELCOME on successful auth.
- AUTHENTICATE: Handled by the gate; credentials are forwarded to the authorization subsystem.
- SUBSCRIBE / UNSUBSCRIBE: Subscription requests are converted to internal subscribe commands. Options supported by FOX-WAMP include `retained`, `retainedState`, `snapshot`, and protocol extensions such as `after_event_id` (see OpenSpec changes for availability and behavior).
- PUBLISH: Published events translate to internal publish commands. Server-side filtering and retained storage semantics may modify resulting behavior. When publishing with `retained` option the router will store the last value.
- REGISTER / UNREGISTER / CALL / YIELD / RESULT / ERROR: RPC lifecycle is handled by registration of procedures, invocations, and results as per WAMP. Gate ensures request lifecycle is coordinated with internal command queue.

Error handling:

- WAMP ERROR messages are used to surface protocol-level validation and authorization failures. The gate attempts to map internal error codes to appropriate WAMP error responses.

See `lib/wamp/gate.ts` for gate-level implementation and `test/` for behavior examples.

Supported Options / Attributes

The router supports a common set of publish/subscribe options that gates translate from protocol-specific names into internal command options. The list below collects attributes observed in the codebase and documents their meaning and where they are used.

- retained / retain (boolean)
  - Purpose: Persist the last published value in key-value (retained) storage so that new subscribers receive it as an initial event.
  - Usage: Subscribe with `retained: true` to request retained values. Publish with `retain: true` / `retain` to write retained value.

- retainedState (boolean)
  - Purpose: When true, the subscription requests retained values as initial events while still accepting live events.
  - Usage: Treated as `retainedState || retained` by the engine when constructing ActorTrace.

- after (string)
  - Purpose: Specifies a synchronization point.
    - For history replay: Request history records starting after this ID.
    - For retained sync (when `retained` or `retainedState` is true): Delay retained-state lookup until retained key-value storage has committed an event with ID >= this value. Only affects retained replay, not subscription acknowledgement or live events.
  - Usage: Supported by in-memory and SQLite DbEngine. Rejected in distributed/masterfree mode until supported by storage commit visibility.
  - Validation: Must be a non-empty string when used for synchronization; invalid values are rejected with a protocol error.

- snapshot (boolean)
  - Purpose: Request a point-in-time subscription that receives only initial history and/or retained replay.
  - Usage: The router suppresses live events during replay, then terminates the subscription internally after replay completion. No client `UNSUBSCRIBE` command is required.
  - Validation: Must be boolean when present. Engines that do not support snapshot completion reject the option.

- filter (object)
  - Purpose: Server-side data filtering for subscriptions. The server will only forward events whose body matches the filter predicate. See `isDataFit` in `lib/realm.ts` for matching semantics.

- mission (string)
  - Purpose: (Present in API usage) Reserved for routing/aggregation targets in Map-Reduce / reducer scenarios.

- acknowledge / ack / needAck (boolean)
  - Purpose: When publishing, request an acknowledgement (publication confirmation / assigned event id). In WAMP gate `opt.acknowledge` is converted to internal `ack` flag.

- exclude_me / excludeMe (boolean)
  - Purpose: Publisher-side option to avoid delivering published event back to the publisher's own subscriptions. Default behavior: `exclude_me` is true unless explicitly set to false by the client.

- when (object|null)
  - Purpose: Conditional publish semantics for key-value storage: only publish if stored value matches the `when` predicate (or is null to indicate absence).

- watch (boolean)
  - Purpose: Used with `when`. When true, the publish waits until the `when` condition is satisfied and then the publish proceeds; useful for synchronization/mutex patterns. See demo `democli/resource-lock.js` and tests in `test/55.kv.ts`.

- will (any)
  - Purpose: Key-value will value to assign on unexpected disconnect. Used with retained storage to automatically clear or set values when the client disconnects unexpectedly.

- reducer (boolean)
  - Purpose: When registering a procedure with `reducer: true` it indicates reduce-mode (map-reduce style) behavior; registration flow treats it as a traced registration.

- concurrency / simultaneousTaskLimit (integer)
  - Purpose: Controls concurrent execution for registered procedures. WAMP `concurrency` is mapped to `simultaneousTaskLimit` internally (use -1 for unlimited).

- progress / receive_progress (boolean)
  - Purpose: RPC progressive results. `receive_progress` in WAMP call options is translated to internal invocation options; `progress` is used when sending YIELD/progress.

- trace / keepTraceFlag / traceStarted (boolean)
  - Purpose: Internal tracing flags controlling whether an event is traced, whether the trace opt is kept in outgoing events, and subscription trace lifecycle.

- headers / hdr (object)
  - Purpose: Arbitrary key-value headers carried with calls and events; preserved by gates.

- delta (boolean)
  - Purpose: Events marked as delta are treated differently when subscribers requested `retained` vs non-retained streams; used in filtering inside `ActorTrace.filter`.

Notes:
- Protocol gates (WAMP/MQTT) perform some option name normalization (for example WAMP's `acknowledge` → internal `ack`, and MQTT `retain` → internal `retained`). See `lib/wamp/gate.ts`, `lib/mqtt/gate.ts`, and `lib/hyper/client.ts` for mappings.
- Engine and storage support varies: e.g., `after_event_id` is only supported when the engine exposes `supportsRetainedEventSync` and provides retained commit visibility; otherwise the option is rejected.

Examples

Subscribe to retained values (WAMP client example):

```javascript
session.subscribe('key.value.#', (args, kwargs, options) => {
  console.log('event-handler', args, kwargs)
}, { retained: true })
```

Subscribe and wait for retained visibility using after_event_id (example using internal API):

```javascript
// after publishing and obtaining eventId
const eventId = await api.publish('key.value.1', { status: 'ready' }, { acknowledge: true, retain: true })

// subscribe, requesting retained replay only after the stored event with eventId is visible
await api.subscribe('key.value.1', (body) => console.log('retained value', body), { retained: true, after: eventId })
```

Subscribe to a retained snapshot:

```javascript
await api.subscribe('key.value.1', (body) => console.log('snapshot value', body), { retained: true, snapshot: true })
```

Publish with conditional (when), watch and will options (WAMP client example):

```javascript
session.publish(
  'myapp.resource',
  [{ pid: process.pid, value: 'handle-resource' }],
  { },
  { acknowledge: true, retain: true, when: null, will: null, watch: true }
).then(result => {
  // obtained ack (event id) and holds the lock until publish changed or disconnect
}, reason => {
  // watch failed, condition not satisfied
})
```
