'use strict'

const { SESSION_WARNING } = require('../messages')
const BaseGate = require('../base_gate')
const RealmError = require('../realm_error').RealmError
const errorCodes = require('../realm_error').errorCodes
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
    const session = this.getSession()
    if (session.getLastPublishedId() == cmd.qid) {
      return // do not duplicate MQTT events
    }
    const customId = this.getSession().genSessionMsgId()
    session.waitForId(cmd.qid, customId)
    session.setLastPublishedId(cmd.qid)

    let payload = ''
    if (cmd.data === null) {
      payload = Buffer.alloc(0)
    } else
    if (cmd.data.payload !== undefined) {
      payload = cmd.data.payload
    } else
    if (cmd.data.kv !== undefined) {
      payload = Buffer.from(JSON.stringify(cmd.data.kv))
    } else
    if (cmd.data.args instanceof Array && cmd.data.args.length === 0 && cmd.data.kwargs !== undefined) {
      payload = Buffer.from(JSON.stringify(cmd.data.kwargs))
    } else {
      payload = Buffer.from(JSON.stringify(cmd.data))
    }
    this.mqttSend({
      topic: restoreMqttUri(cmd.uri),
      payload: payload,
      qos: (cmd.opt.trace ? 1 : 0),
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

  sendError (cmd, code, text) {
    if (undefined === cmd.id) {
      throw new RealmError(this.getId(), code, text)
    }
    else {
      // subscribe error mode
      const pkg = this.getId()
      pkg.granted[cmd.id] = 0x80
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
      throw new RealmError(requestId, errorCodes.ERROR_NOT_AUTHORIZED)
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
      result = message.username.match(/(.*)@([a-zA-Z0-9-]*)$/i)
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
      opt.trace = true
    }

    const cmd = {
      mtype: 'publish',
      uri: mqttParse(message.topic),
      data: (message.payload.length === 0
        ? null
        : { payload: message.payload }
      ),
      id: message.messageId,
      opt
    }
    if (this.checkAuthorize(ctx, cmd, 'publish')) {
      return cmd
    }
    return false
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
        console.log(err)
        ctx.mqttClose(1003, err.message)
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
  ctx.mqttClose(1000, 'Server closed session')
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
      session.realm.setKeyData(
        ['$FOX', 'clientOffset', session.secureDetails.clientId],
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
  const pkg = {
    id: message.messageId,
    granted: [],
    count: message.subscriptions.length
  }
  ctx.setId(pkg)
  const afterId = session.getLastPublishedId()
  for (let index=0; index < message.subscriptions.length; index++) {
    const qos = Math.min(message.subscriptions[index].qos, 1)
    pkg.granted[index] = qos
    const uri = mqttParse(message.subscriptions[index].topic)
    const opt = {}
    if (qos > 0) {
      opt.keepTraceFlag = true
    }
    if (afterId) {
      opt.after = afterId
    }
    if (message.retain) {
      opt.retained = true
    }
    const cmd = {
      mtype: 'subscribe',
      id: index,
      uri,
      opt
    }
    if (this.checkAuthorize(ctx, cmd, 'subscribe')) {
      session.realm.doTrace(ctx, cmd)
    }
  }
}

cmdAck.subscribe = function (cmd) {
  this.mqttSubscribeDone()
}

module.exports = MqttGate
