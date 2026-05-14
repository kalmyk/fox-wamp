# MQTT API (Overview)

This document describes how FOX-WAMP handles MQTT protocol messages and how MQTT topics are mapped into the router.

Key points:

- FOX-WAMP supports MQTT 3.1 semantics via an MQTT gate which translates MQTT CONNECT/PUBLISH/SUBSCRIBE messages into internal Hyper API calls.
- Topic translation: MQTT topics using slashes (e.g. `app/topic/name`) are converted into WAMP-style dotted topics (`app.topic.name`) when bridged. Wildcards are mapped according to typical MQTT-to-topic translation rules.
- QoS: The gate implements MQTT QoS up to the level required by the project. Persistent retained messages are supported and integrate with the router's retained storage.

Supported behaviors:

- CONNECT / CONNACK: Client authentication is validated by the gate and forwarded to the authorization subsystem.
- SUBSCRIBE / UNSUBSCRIBE: Subscriptions are translated into internal subscriptions with equivalent topic filters. Retained message replay follows the router's retained-state semantics.
- PUBLISH: Incoming publications are converted to internal publish commands. Retained flag handling persists messages in the router's retained storage.

Error handling:

- MQTT-level acknowledgement and error codes are returned according to MQTT semantics. The gate maps internal errors back to MQTT return codes when possible.

See `lib/mqtt/gate.ts` and `bin/mqtt_gate.js` for examples and tests in `test/22.mqtt.js`.

Supported Options / Attributes

MQTT gate maps MQTT publish/subscribe options to the router's internal options. The following attributes are supported or mapped by the gate and by the router core:

- retain / retained (boolean)
  - MQTT `retain` is mapped to the router's retained storage. When a published message has `retain: true`, the router stores it in key-value (retained) storage.

- qos / acknowledge / ack (integer/boolean)
  - MQTT QoS levels are handled by the MQTT gate. The router supports an acknowledgement flag for publishers that requests a publication response containing the assigned event id.

- subscribe wildcards and topic mapping
  - MQTT topic filters (with `+` and `#`) are converted to internal dotted-topic form and matched against subscriptions.

- exclude_me (boolean)
  - When publishing via gates, the `exclude_me` option controls whether the publisher receives its own published events. MQTT gate sets `exclude_me` according to the mapped options.

- trace / after
  - The MQTT gate can map session/trace/persistent options such as `trace` and `after` where applicable. `after` support for retained synchronization follows the same engine constraints as WAMP (in-memory and SQLite engines only).

- when / watch / will
  - Key-value conditional publish semantics (`when`) and `watch` behaviour (blocking publish until `when` condition is satisfied) are supported when using the key-value storage features exposed by the router. `will` semantics for retained KV writes are integrated with the key-value engine.

Notes:
- See `lib/mqtt/gate.ts` for where options are normalized and forwarded to internal publish/subscribe commands. Tests in `test/22.mqtt.js` and `test/55.kv.ts` show behavior examples.

Examples

MQTT publish with retain and QoS (mqtt.js client example):

```javascript
const mqtt = require('mqtt')
const client = mqtt.connect('mqtt://localhost:1883')

client.publish('app/topic/key', JSON.stringify({ status: 'ready' }), { qos: 1, retain: true })
```

Subscribe to retained values and bridge to WAMP (conceptual):

```javascript
// MQTT subscribe, router will translate topic to internal dotted form
client.subscribe('app/topic/#')

// When using HyperClient or WAMP client, subscribe with retained option
api.subscribe('app.topic.key', (body) => console.log('retained', body), { retained: true })
```
