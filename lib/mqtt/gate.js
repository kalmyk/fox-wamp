'use strict'

const { SESSION_WARNING } = require('../messages')
const BaseGate = require('../base_gate')
const RealmError = require('../realm_error').RealmError
const { mqttParse, restoreMqttUri } = require('../topic_pattern')
const Context = require('../context')

const CONNACK_RETURN_ACCEPTED = 0
const CONNACK_RETURN_UNACCEPTABLE_PROTOCOL_VERSION = 1
const CONNACK_RETURN_IDENTIFIER_REJECTED = 2
const CONNACK_RETURN_SERVER_UNAVAILABLE = 3
const CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD = 4
const CONNACK_RETURN_NOT_AUTHORIZED = 5

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

class MqttContext extends Context {
  sendEvent (cmd) {
    let session = this.getSession()
    if (session.getLastPublishedId() == cmd.qid) {
      return  // do not duplicate MQTT events
    }
    let customId = this.getSession().genSessionMsgId()
    session.waitForId(cmd.qid, customId)
    session.setLastPublishedId(cmd.qid)

    let payload = ''
    if (cmd.data.payload !== undefined) {
      payload = cmd.data.payload
    } else
    if (cmd.data.args !== undefined) {
      payload = Buffer.from(JSON.stringify(cmd.data.args))
    } else
    if (cmd.data.kwargs !== undefined) {
      payload = Buffer.from(JSON.stringify(cmd.data.kwargs))
    } else
    if (cmd.data.kv !== undefined) {
      payload = Buffer.from(JSON.stringify(cmd.data.kv))
    }
    this.mqttSend({
      topic: restoreMqttUri(cmd.uri),
      payload: payload,
      qos: (cmd.opt.history ? 1 : 0),
      messageId: customId,
      cmd: 'publish'
    })
  }

  acknowledged (cmd) {
    cmdAck[cmd.mtype].call(this, cmd)
  }

  mqttSend (msg, callback) {
    this.sender.send(msg, callback)
  }

  mqttClose (code, reason) {
    this.sender.close(code, reason)
  }

  error (id, code, msg) {
    if (undefined === id) {
      throw new RealmError(this.getId(), code, msg)
    }
    else {
      // subscribe mode
      const pkg = this.getId()
      pkg.granted[id] = 0x80
      this.mqttSubscribeDone()
    }
  }

  mqttSubscribeDone () {
    // granted is accepted QoS for the subscription, possible [0,1,2, + 128 or 0x80 for failure]
    const pkg = this.getId()
    pkg.count--
    if (pkg.count === 0) {
      this.mqttSend({ cmd: 'suback', messageId: pkg.id, granted: pkg.granted })
    }
  }

  mqttConnack (returnCode, sessionPresent) {
    this.mqttSend({ returnCode, sessionPresent, cmd: 'connack' })
  }
}

class MqttGate extends BaseGate {
  createContext (session, sender) {
    return new MqttContext(this._router, session, sender)
  }

  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized')
    }
  }

  joinRealm (ctx, session, message) {
    this.getRouter().getRealm(session.realmName, (realm) => {
      realm.joinSession(session)
      if (message.will) {
        session.setDisconnectPublish(ctx, this.makePublishCmd(ctx, message.will))
      }
      if (session.secureDetails.clientId) {
        let found = false
        realm.getKey(
          ['$FOX', 'clientOffset', session.secureDetails.clientId],
          (key, data) => {
            session.setLastPublishedId(data)
            found = true
          }
        ).then(() => {
          ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, found)
        })
      } else {
        ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, false)
      }
    })
  }

  connect (ctx, session, message) {
    let result
    if (typeof message.username === 'string') {
      result = message.username.match(/(.*)@([a-z0-9]*)$/i)
    }
    session.secureDetails = {}
    if (result) {
      session.realmName = result[2]
      session.secureDetails.username = result[1]
    } else if (message.username) {
      ctx.mqttConnack(CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD, false)
      return
    }
    if (message.clientId) {
      session.secureDetails.clientId = message.clientId
      session.secureDetails.sessionClean = message.clean
    }

    if (this.isAuthRequired(session)) {
      if (!session.realmName) {
        ctx.mqttConnack(CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD, false)
      }
      this._authHandler.auth(session.realmName, session.secureDetails, message.password, (err, userDetails) => {
        if (err) {
          ctx.mqttConnack(CONNACK_RETURN_NOT_AUTHORIZED, false)
        } else {
          session.setUserDetails(userDetails)
          this.joinRealm(ctx, session, message)
        }
      })
    } else {
      if (!session.realmName) {
        session.realmName = 'default-realm'
      }
      this.joinRealm(ctx, session, message)
    }
  }

  makePublishCmd (ctx, message) {
    let opt = {}
    if (message.retain) {
      opt.retain = true
    }
    if (message.qos >= 1) {
      opt.history = true
    }

    let uri = mqttParse(message.topic)
    this.checkAuthorize(ctx, 'publish', uri, message.messageId)

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
      this._router.emit(SESSION_WARNING, session, 'no object arrived', msg)
      ctx.mqttClose(1003, 'protocol violation')
      return
    }
    let mtype = msg.cmd
    if (!handlers[mtype]) {
      this._router.emit(SESSION_WARNING, session, 'command not found', msg)
      ctx.mqttClose(1003, 'protocol violation')
      return
    }
    try {
      handlers[mtype].call(this, ctx, session, msg)
    } catch (err) {
      if (err instanceof RealmError) {
        ctx.mqttClose(1003, err.message)
        console.log(err)
      } else {
        throw err
      }
    }
  }

  getProtocol () {
    return 'mqtt'
  }
}

handlers.connect = function (ctx, session, message) {
  if (session.realm === null) {
    this.connect(ctx, session, message)
  } else {
    ctx.mqttConnack(CONNACK_RETURN_IDENTIFIER_REJECTED, false)
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
  if (message.qos >= 1) {
    cmd.ack = true
  }
  session.realm.doPush(ctx, cmd)
}

cmdAck.publish = function (cmd) {
  this.mqttSend({ cmd: 'puback', messageId: cmd.id })
}

handlers.puback = function (ctx, session, message) {
  this.checkRealm(session)
  let qid = session.fetchWaitId(message.messageId)
  if (qid) {
    session.realm.doConfirm(ctx, {
      id: qid
    })
    if (session.secureDetails && session.secureDetails.clientId) {
      session.realm.setKey(
        ['$FOX', 'clientOffset', session.secureDetails.clientId],
        0, // session.sessionId,
        qid,
        qid
      )
    }
  }
}

handlers.pingreq = function (ctx, session, message) {
  ctx.mqttSend({ cmd: 'pingresp' })
}

handlers.subscribe = function (ctx, session, message) {
  this.checkRealm(session)
  let pkg = {
    id: message.messageId,
    granted: [],
    count: message.subscriptions.length
  }
  ctx.setId(pkg)
  const afterId = session.getLastPublishedId()
  for (let index=0; index < message.subscriptions.length; index++) {
    let qos = Math.min(message.subscriptions[index].qos, 1)
    pkg.granted[index] = qos
    let uri = mqttParse(message.subscriptions[index].topic)
    if (this.checkAuthorize(ctx, 'subscribe', uri, index)) {
      let opt = {}
      if (qos > 0) {
        opt.keepHistoryFlag = true
      }
      if (afterId) {
        opt.after = afterId
      }
      if (message.retain) {
        opt.retained = true
      }
      session.realm.doTrace(ctx, {
        mtype: 'subscribe',
        id: index,
        uri,
        opt
      })
    }
  }
}

cmdAck.subscribe = function (cmd) {
  this.mqttSubscribeDone()
}

module.exports = MqttGate
