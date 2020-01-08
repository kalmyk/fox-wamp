'use strict'

const BaseGate = require('../base_gate')
const RealmError = require('../realm_error').RealmError
const { mqttParse, restoreUri } = require('../topic_pattern')

/*
// mosquitto_pub -d -u realm1 -P passwd -t com.myapp.topic1 -m "the message"

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

===========================================================

$ mosquitto_sub -c -i this-agent-session --will-topic wt --will-payload wt-disconnected -t test

MQTT ARRIVED Packet {
  cmd: 'connect',
  retain: false,
  qos: 0,
  dup: false,
  length: 51,
  topic: null,
  payload: null,
  protocolId: 'MQTT',
  protocolVersion: 4,
  will: 
   { retain: false,
     qos: 0,
     topic: 'wt',
     payload: <Buffer 77 74 2d 64 69 73 63 6f 6e 6e 65 63 74 65 64> },
  clean: false,
  keepalive: 60,
  clientId: 'this-agent-session' }
 */

let handlers = {}
let cmdAck = {}

class MqttGate extends BaseGate {
  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized')
    }
  }

  hello (ctx, session, message) {
    session.realmName = message.username

    // session.setSessionName(message.clientId, message.clean)

    if (this.isAuthRequired(session)) {
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
        if (message.will) {
          session.setDisconnectPublish(this.makePublishCmd(ctx, message.will))
        }
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
      topic: restoreUri(cmd.uri),
      payload: payload,
      qos: 0,
      messageId: cmd.qid,
      cmd: 'publish'
    })
  }

  makePublishCmd(ctx, message) {
    let opt = {}
    if (message.retain) {
      opt.retain = true
    }
  
    let uri = mqttParse(message.topic)
    this.checkAuthorize(ctx, 'publish', uri)

    let data
    if (message.payload.length === 0) {
      data = null
    } else {
      data = { payload: message.payload }
    }
    return {
      mtype: 'publish',
      uri,
      data,
      id: message.messageId,
      opt
    }  
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
        session.close(1003, err.message)
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
    this.hello(ctx, session, message)
  } else {
    session.close(1002, 'protocol violation')
  }
  return false
}

handlers.disconnect = function (ctx, session, message) {
  // do not send WILL notification at correct disconnect
  session.cleanDisconnectPublish()
  return false
}

handlers.publish = function (ctx, session, message) {
  this.checkRealm(session)
  // Error: Invalid publish topic 'com.myapp/#', does it contain '+' or '#'?

  let cmd = this.makePublishCmd(ctx, message)
  if (message.qos === 0) {}
  else if (message.qos === 1) {
    cmd.ack = true
  }
  else {
    throw new RealmError(message.messageId, 'QoS "'+message.qos+'" is not supported')
  }
  session.realm.doPush(session, cmd)
}

cmdAck.publish = function (session, cmd) {
  session.send({ cmd: 'puback', messageId: cmd.id })
}

handlers.pingreq = function (ctx, session, message) {
  this.sendPingResp(session)
}

handlers.subscribe = function (ctx, session, message) {
  this.checkRealm(session)
  let id = message.messageId
  ctx.setId(id)
  for (let index in message.subscriptions) {
    let uri = mqttParse(message.subscriptions[index].topic)
    this.checkAuthorize(ctx, 'subscribe', uri)
    session.realm.doTrace(session, {
      mtype: 'subscribe',
      id,
      uri,
      opt: {}
    })
  }
}

cmdAck.subscribe = function (session, cmd) {
  session.send({ cmd: 'suback', messageId: cmd.id, granted: [0] })
}

module.exports = MqttGate
