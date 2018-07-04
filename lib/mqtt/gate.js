/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
    RealmError = require('../realm_error').RealmError;

/*

parse Packet {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 49,
  topic: null,
  payload: null,
  protocolId: 'MQIsdp',
  protocolVersion: 3,
  clean: true,
  keepalive: 60,
  clientId: 'mosqpub|2386-ats-ora5',
  username: 'user',
  password: <Buffer 70 61 73 73 77 64> }
generate { returnCode: 0, sessionPresent: false, cmd: 'connack' }
parse Packet {
  cmd: 'publish',
  retain: false,
  qos: 0,
  dup: false,
  length: 17,
  topic: 'test',
  payload: <Buffer 74 68 65 20 6d 65 73 73 61 67 65> }
parse Packet {
  cmd: 'disconnect',
  retain: false,
  qos: 0,
  dup: false,
  length: 0,
  topic: null,
  payload: null }

*/

var handlers = {},
    cmdAck   = {};

var MqttGate = function (router) {

    // authHandler.authenticate(realmName, secureDetails, secret, callback)
    let authHandler;
    this.makeSessionId = router.makeSessionId;

    this.emit = function () {
        router.emit.apply(router, arguments);
    };

    this.setAuthHandler = function(auth) {
        authHandler = auth;
    };

    this.isAuthRequired = function() {
        return (typeof authHandler !== 'undefined');
    };

    this.checkRealm = function (session, requestId) {
        if (!session.realm) {
            throw new RealmError(requestId, "wamp.error.not_authorized");
        }
    };

    this.hello = function(session, message) {
        session.realmName = message.username;
        if (this.isAuthRequired()) {
            session.secureDetails = details;
            if (details.hasOwnProperty('authmethods') && details.authmethods.indexOf('ticket') >= 0) {
                this.sendChallenge(session, 'ticket', {});
            } else {
                this.sendAbort(session, "wamp.error.authorization_failed");
            }
        }
        else {
            router.getRealm(session.realmName, function (realm) {
                realm.joinSession(session);
                this.sendWelcome(session);
            }.bind(this));
        }
    }

    this.sendWelcome = function (session) {
        session.send({ returnCode: 0, sessionPresent: false, cmd: 'connack' });
    };

    this.handle = function (session, msg) {
        if (typeof msg !== 'object') {
            this.terminate(session, 1003, "protocol violation");
            return;
        }
        var mtype = msg.cmd;
        if (!handlers[mtype]) {
            this.terminate(session, 1003, "protocol violation");
            return;
        }
        try {
            handlers[mtype].call(this, session, msg);
        }
        catch (err) {
            if (err instanceof RealmError) {
                this.mqttSendError(session, mtype, err.requestId, err.message, err.args);
            }
            else {
                throw err;
            }
            return;
        }
    };
  this.registerSession = function (session) {
    router.emit('connection', session);
  };
  this.cleanupSession = function (session) {
    router.emit('disconnection', session);
  };
};

handlers.connect = function(session, message) {
//    var realmName = message.shift();
//    var details = message.shift();
    if (session.realm === null) {
        this.hello(session, message);
    }
    else {
        this.terminate(session, 1002, "protocol violation");
    }
    return false;
};

handlers.disconnect = function(session, message) {
    return false;
};

handlers.publish = function(session, message) {
    this.checkRealm(session);
    session.realm.doPush(session, {
        qtype:'publish',
        uri:message.topic,
        data:{payload:message.payload}
    });
};

module.exports = MqttGate;

/// mosquitto_pub -d -u realm1 -P passwd -t com.myapp.topic1 -m "the message"
