'use strict'

const BaseGate = require('../base_gate')
const RealmError = require('../realm_error').RealmError

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

let handlers = {}
let cmdAck = {}

class MqttGate extends BaseGate {
  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized')
    }
  }

  hello (session, message) {
    session.realmName = message.username
    if (this.isAuthRequired()) {
      console.log('hello', message)
      session.secureDetails = message
      if (details.hasOwnProperty('authmethods') && details.authmethods.indexOf('ticket') >= 0) {
        this.sendChallenge(session, 'ticket', {})
      } else {
        this.sendAbort(session, 'wamp.error.authorization_failed')
      }
    } else {
      this.getRouter().getRealm(session.realmName, function (realm) {
        realm.joinSession(session)
        this.sendWelcome(session)
      }.bind(this))
    }
  }

  sendWelcome (session) {
    session.send({ returnCode: 0, sessionPresent: false, cmd: 'connack' })
  }

  sendPingResp (session) {
    session.send({ cmd: 'pingresp' })
  };

  sendEvent (session, cmd) {
    let payload = ''
    if (cmd.data.payload !== undefined) {
      payload = cmd.data.payload
    } else
    if (cmd.data.args !== undefined) {
      payload = new Buffer(JSON.stringify(cmd.data.args))
    } else
    if (cmd.data.kwargs !== undefined) {
      payload = new Buffer(JSON.stringify(cmd.data.kwargs))
    } else
    if (cmd.data.kv !== undefined) {
      payload = new Buffer(JSON.stringify(cmd.data.kv))
    }
    session.send({
      topic: cmd.uri,
      payload: payload,
      qos: 0,
      messageId: cmd.qid,
      cmd: 'publish'
    })
  }

  handle (ctx, session, msg) {
    if (typeof msg !== 'object') {
      session.close(1003, 'protocol violation')
      return
    }
    let mtype = msg.cmd
    if (!handlers[mtype]) {
      session.close(1003, 'protocol violation')
      return
    }
    try {
      handlers[mtype].call(this, ctx, session, msg)
    } catch (err) {
      if (err instanceof RealmError) {
        this.mqttSendError(session, mtype, err.requestId, err.message, err.args)
      } else {
        throw err
      }
    }
  }

  acknowledged (session, cmd) {
    cmdAck[cmd.mtype].call(this, session, cmd)
  }

  getProtocol () {
    return 'mqtt'
  }
}

handlers.connect = function (ctx, session, message) {
//    var realmName = message.shift();
//    var details = message.shift();
  if (session.realm === null) {
    this.hello(session, message)
  } else {
    session.close(1002, 'protocol violation')
  }
  return false
}

handlers.disconnect = function (ctx, session, message) {
  return false
}

handlers.publish = function (ctx, session, message) {
  this.checkRealm(session)
  session.realm.doPush(session, {
    mtype: 'publish',
    uri: message.topic,
    data: { payload: message.payload }
  })
}

handlers.pingreq = function (ctx, session, message) {
  this.sendPingResp(session)
}

handlers.subscribe = function (ctx, session, message) {
  this.checkRealm(session)
  for (var index in message.subscriptions) {
    session.realm.doTrace(session, {
      mtype: 'subscribe',
      id: message.messageId,
      uri: message.subscriptions[index].topic,
      opt: {}
    })
  }
}

cmdAck.subscribe = function (session, cmd) {
  console.log('cmdAck.subscribe', cmd)
  session.send({ cmd: 'suback', messageId: cmd.id, granted: [0] })
}

module.exports = MqttGate

/// mosquitto_pub -d -u realm1 -P passwd -t com.myapp.topic1 -m "the message"
