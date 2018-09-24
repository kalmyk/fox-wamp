# FOX-WAMP is a message router implementation

The project goal is to provide durable message source.

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
* weak: The key disappears then client disconnects. (private:public) who could see the message, public by default
* when: publish only if the key meets requirements. null means that key should not be exists.
* watch: applicable for when option only. Provide ability to wait required conditions and do action immediately. If several clients waits for that the only one achieves acknowledge message.
* sequence: generate unique key

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
