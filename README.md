# FOX-WAMP is a The Web Application Message Server

[![Build Status](https://travis-ci.org/kalmyk/fox-wamp.svg?branch=master)](https://travis-ci.org/kalmyk/fox-wamp)

The Web Application Message Server goal is to provide durable message source for the actual web applications.

Message router has pluggable interface to the several message protocols. As for now it could interact by
* [WAMP V2 Basic Profile](http://wamp-proto.org/)
* [MQTT 3.1](http://mqtt.org/)

It means that event could be send through MQTT interface and handled by WAMP client. Topic notation is translated automatically from "app/topic/name" in MQTT to "app.topic.name" in WAMP.

## Build Instructions

Install using npm. Depending on what you want to do.
```
npm install fox-wamp
```

## Credits

fox-wamp has been inspired by the following Open Source projects:

- [wamp.rt](https://github.com/Orange-OpenSource/wamp.rt)
- [wamp.io](https://github.com/nicokaiser/wamp.io)

## Mission
Provide message based connectivity between web applications and several backend servers such as session storage, database and cache.

## Template to share HTTP port with express
To open server socket with shared port between express and FoxRouter need to use HTTP module as it shown below
```javascript
const http = require('http')
const express = require('express')
const FoxRouter = require('fox-wamp')

const PORT = process.env.PORT || 5000

let app = express()
app.get('/', (req, res) => res.send('Hello World!'))

let httpServer = http.createServer(app)
httpServer.listen(PORT, () => console.log(`Listening on ${ PORT }`))

router = new FoxRouter()
router.listenWAMP({server: httpServer, path: "/wamp"})
```

and correspondingly the web socket client connection string will look like
```javascript
let autobahn = require('autobahn')
let connection = new autobahn.Connection({
    url: 'ws:localhost:5000/wamp',
    realm: 'realm1'
})
```

## Secure connection to the router
```javascript
const https    = require('https')

let httpsServer = https.createServer({
    key: fs.readFileSync(__dirname + '/config/server.key'),
    cert: fs.readFileSync(__dirname + '/config/server.crt')
})
router.listenWAMP({server: httpsServer, path: "/wss"})
```

## Demo Application
Such kind of event dispatchers are better integrate with event driven
frontend frameworks such as React JS. Here is chat application that
includes frontend part on React JS and backend server on Fox-WAMP.

https://github.com/kalmyk/reflux-chat

## Retained Storage
There is a storage to keep last content of published message.
The values from the storage is retrived as immediate initial messages for the subscription if `retained` flag is pecified.

```javascript
register('key.value.#', (args, kwargs, options) => {
        console.log('event-handler', args, kwargs)
    },
    { retained: true }
)
```
to store event in the storage publisher should specify `retain` flag

```javascript
session.publish('key.value.1', [ 'args' ], { kwArgs: true }, {
    retain: true,
    when: { status: 'started' },
    watch: false
    will: { value: 'to', publish: 'at', session: 'disconnect' }
  })
```

### Publish Options Description
* retain: boolean, keep in Key Value storage. Default value is false that means message does
  not retain.
* when: struct, publish the event only if value in the storage meets the value. If the `when` key is `null` that means the key not exists in stored value or value is not present.
* watch: boolean, applicable if `when` option defined. Provides ability to wait for the required condition in storage and then do the publish immediately. If several clients waits for same value the only one achieves acknowledge of publish.
* will: value that will be assigned at session unexpected disconnect. If the value is changed by any process the `will` value is cleaned.

### Synchronization Service
The options above provide ability to use the server as Synchronization Service. The `watch` option
is designed to delay acknowledge response of publish due to necessary conditions described in `when` option achieved. See the demo in `democli\resource-lock.js`. If the demo is started in several terminal session it is possible to see where master is.

#### lock mutex
The code below will lock resource mutex if it is available
and unlock it automatically if connection lost

```javascript
    session.publish(
      'myapp.resource',
      [],
      { pid: process.pid, value: 'handle-resource' },
      { acknowledge: true, retain: true, when: null, will: null, watch: true }
    ).then(
      (result) => {
        console.log('Master Resource Locked', result)
      }, (reason) => {
        console.log('FAILED', reason)
        connection.close()
      }
    )
```

#### unlock mutex
To force unlock the resource need to simple publish necessary value to the resource channel.
The same function is invoked on disconnect if `will` value is specified.

```javascript
    session.publish(
      'myapp.resource',
      [],
      null,
      { acknowledge: true, retain: true }
    )
```

## Event Filter
Subscription is able to filter messages before firing on the server side.
This could dramatically reduce network consumption.

```javascript
register('some.key.#', (args, kwargs) => {
        // do some action here
    },
    { filter: { type: 'post' } }
)
```

## Map-Reduce, coming soon
Map-Reduce processing in terms of message queue is tranforming of the input stream
to be passed to the corresponding event topic and reduced there.
As Map function is possible to use any regular function registration. 
Reduce is the function that gather events published to topic to the ratained dataset.

```javascript
register('reduce.the.key.#', (args, kwargs, options) => {
        return options.retained + kwargs.value
    },
    { reducer: true }
)
```

### Subscribe Options
* retained: boolean, corresponding values from key value storage will be returned as immidiate events.
* reducer:
* filter: condition to filter messages that accepted by the subscription

### Aggregate Engine for the data streams

<p>
    What if to define table structure along with aggregation functions in the same information schema?
    That could look like some kind of transaction definition that is represent in json schema.
</p>
<p>
    The idea is to have definitions of cross table relations and calculation rules in one place. 
    Such table scheme could easy listen to the events stream and do changes
    in the related tables accordingly.
</p>
<p>
    The functionality aimed to provide rapid access to continuously changed
    data to the modern web application.
</p>
<p>
    The changes in tables could be transformed and
    propagated as same events to the another aggregation tables 
    where it could be mixed with another sources.
    Aggregate engine provides data change events for the subscribed clients.
    In the same way standard web queue could subscribe to such the aggregated
    event sources.
</p>
<p>
    In general the idea looks like materialized view that is gathered on event stream.
    The information schema provides ability to validate incoming messages against the schema.
</p>

```javascript
    "invoice": {
        "type": "object",
        "properties": {
            "date": { "type": "string" },
            "customer": { "type": "string" },
            "amount": { "type": "string" }
        },
        "primary_key":[ "date", "customer" ],
        "propagate":{
            "detail":[{
                "key": [ "customer" ],
                "fields": { "total": "amount" },
                "filter": {"type":"sale"}
            }]
        }
    },

    "detail": {
        "type": "aggregate",
        "properties": {
            "customer": { "type": "string" },
            "total": { "type": "string" }
        },
        "primary_key": [ "customer" ],
        "sum": [ "total" ]
    }
```

Take a look for more use cases at http://jeta.host/

## Changes:
2019-04-11
- authorize function supported for SUBSCRIBE & PUBLISH

2019-03-22
- WAMP registration option.concurrency supported.

2018-07-19
- MQTT gate added. Functionality allows to subscribe to the MQTT messages.

2018-01-25:
- Pattern based subscription added. Thanks to https://github.com/davedoesdev/qlobber

2017-05-24:
- Session Meta Events added (wamp.session.on_join & wamp.session.on_leave).

2017-05-17:
- Concrete topic published to
- Progressive Calls (receive_progress & progress)

2017-05-07:
- exclude_me option of publish

2017-04-26:
- integration with [StatsD](https://github.com/etsy/statsd)

2016-04-03:
- ticket auth support added

2016-03-09:
- internal api moved to realm
- callrpc method has args & kwargs arguments
- publish method does not require message id
