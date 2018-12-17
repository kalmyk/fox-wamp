# FOX-WAMP is a The Web Application Message Server

The project goal is to provide durable message source for the actual web applications.

Message router has pluggable interface to the several message standards. As for now it could interact by
* [WAMP V2 Basic Profile](http://wamp-proto.org/)
* [MQTT](http://mqtt.org/)

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

let httpServer = http.createServer(app)
httpServer.listen(PORT, () => console.log(`Listening on ${ PORT }`))

router = new FoxRouter()
router.listenWAMP({server: httpServer, path: "/wss"})
```

and correspondingly the web socket client connection will look like as
```javascript
var autobahn = require('autobahn');
let connection = new autobahn.Connection({
    url: 'ws:localhost:5000/wss',
    realm: 'realm1'
});
```

## Secure connection to the router
```javascript
const https    = require('https')

let httpsServer = https.createServer({
    key: fs.readFileSync(__dirname + '/config/server.key'),
    cert: fs.readFileSync(__dirname + '/config/server.crt')
});
router.listenWAMP({server: httpsServer, path: "/wss"})
```

## The Roadmap
It is good to have some storage to keep last published message. The server
has to maintain persistence of keys and provide the value as immediate first
message for the subscription. And here what could be implemented

```javascript
publish('the.key', ['args'], {kwArgs:false}, {
    retain: 100,
    weak: 'public',
    when: {status:'started'},
    watch: false
  });
```

### Options Description
* retain: time in seconds to keep the message in the server memory. Zero means forever. Default value is false that means message does no retain.
* weak: The key disappears then client disconnects. (private|public) who could see the message, public by default
* when: publish only if the key meets requirements. null means that key should not be exists.
* watch: applicable if `when` option defined. Provide ability to wait the necesssary condition and do action immediately. If several clients waits for that the only one achieves acknowledge message.
* sequence: generate unique key

### Aggregate Engine for the data streams

Provide rapid access to continuously changed data to the web application.
To support data update propagation. The idea is to have definition of cross table relations and calculation rules.

```javascript
    customer {
        "type": "object",
        "properties": {
            "date": { "type": "string" },
            "customer": { "type": "string" },
            "amount": { "type": "string" }
        },
        "primary_key":["date", "customer"],
        "propagate":{
            "detail":[{
                "key":["customer"],
                "fields":{"total":"amount"}
            }]
        }
    }

    detail {
        "type": "aggregate",
        "properties": {
            "customer": { "type": "string" },
            "total": { "type": "string" }
        },
        "primary_key":["customer"],
        "sum":["amount"]
    }
```

## Changes:
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
