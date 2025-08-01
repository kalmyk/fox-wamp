'use strict'

const { SESSION_ALERT } = require('../messages')
const { BaseGate, getBodyValue } = require('../base_gate')
const { RealmError, errorCodes } = require('../realm_error')
const { mqttParse, restoreMqttUri } = require('../topic_pattern')
const Context = require('../context')

const CONNACK_RETURN_ACCEPTED = 0
// const CONNACK_RETURN_UNACCEPTABLE_PROTOCOL_VERSION = 1
const CONNACK_RETURN_IDENTIFIER_REJECTED = 2
// const CONNACK_RETURN_SERVER_UNAVAILABLE = 3
const CONNACK_RETURN_BAD_USER_NAME_OR_PASSWORD = 4
const CONNACK_RETURN_NOT_AUTHORIZED = 5

/*
// mosquitto_pub -d -u user@realm1 -P passwd -t com/myapp/topic1 -m '{"test":1}'

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

function toMqttPayload (body) {
  if (body === null) {
    return Buffer.alloc(0)
  }
  if ('payload' in body) {
    return body.payload
  }
  if ('kv' in body) {
    return Buffer.from(JSON.stringify(body.kv))
  }
  if ('args' in body) {
    if (Array.isArray(body.args) && body.args.length == 1) {
      return Buffer.from(JSON.stringify(body.args[0]))
    }
    return Buffer.from(JSON.stringify(body.args))
  }
  throw Error("unknown body type")
}

function parseMqttPayload(payload) {
  return payload.length === 0 ? null : { payload: payload }
}

let handlers = {}

class MqttSocketWriterContext extends Context {
  constructor (router, session, socketWriter) {
    super(router, session)
    this.socketWriter = socketWriter
  }

  setSubscribePkg (mqttPkg) {
    this.mqttPkg = mqttPkg
  }

  getSubscribePkg () {
    return this.mqttPkg
  }

  sendEvent (cmd) {
    const session = this.getSession()
    if (session.getLastPublishedId() == cmd.qid) {
      return // do not duplicate MQTT events on different subscriptions
    }
    const customId = this.getSession().genSessionMsgId()
    session.waitForId(cmd.qid, customId)
    session.setLastPublishedId(cmd.qid)

    this.mqttSend({
      topic: restoreMqttUri(cmd.uri),
      payload: toMqttPayload(cmd.data),
      qos: (cmd.opt.trace ? 1 : 0),
      messageId: customId,
      cmd: 'publish',
      retain: cmd.opt.retained === true
    })
  }

  sendPublished (cmd) {
    this.mqttSend({ cmd: 'puback', messageId: cmd.id })
  }

  sendSubscribed (cmd) {
    this.mqttSubscribeDone()
  }

  mqttSend (msg, callback) {
    this.socketWriter.mqttPkgWrite(msg, callback)
  }

  mqttClose (code, reason) {
    this.socketWriter.mqttPkgClose(code, reason)
  }

  sendError (cmd, code, text) {
    if (undefined === cmd.id) {
      throw new RealmError(undefined, code, text)
    }
    else {
      // subscribe error mode
      const pkg = this.getSubscribePkg()
      pkg.granted[cmd.id] = 0x80
      this.mqttSubscribeDone()
    }
  }

  mqttSubscribeDone () {
    // granted is accepted QoS for the subscription, possible [0,1,2, + 128 or 0x80 for failure]
    const pkg = this.getSubscribePkg()
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
  createContext (session, socketWriter) {
    return new MqttSocketWriterContext(this._router, session, socketWriter)
  }

  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, errorCodes.ERROR_NOT_AUTHORIZED)
    }
  }

  async joinRealm (ctx, session, message) {
    const realm = await this.getRouter().getRealm(session.realmName)
    realm.joinSession(session)
    if (message.will) {
      session.setDisconnectPublish(ctx, this.makePublishCmd(ctx, message.will))
    }
    if (session.secureDetails.clientId) {
      let found = false
      realm.getKey(
        ['$FOX', 'clientOffset', session.secureDetails.clientId],
        (key, data) => {
          session.setLastPublishedId(getBodyValue(data))
          found = true
        }
      ).then(() => {
        ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, found)
      })
    } else {
      ctx.mqttConnack(CONNACK_RETURN_ACCEPTED, false)
    }
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
        session.realmName = 'default_realm'
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
      uri: mqttParse(message.topic),
      data: parseMqttPayload(message.payload),
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
      this._router.emit(SESSION_ALERT, session, 'no object arrived', msg)
      ctx.mqttClose(1003, 'protocol violation')
      return
    }
    if (!handlers[msg.cmd]) {
      this._router.emit(SESSION_ALERT, session, 'command not found', msg)
      ctx.mqttClose(1003, 'protocol violation')
      return
    }
    try {
      handlers[msg.cmd].call(this, ctx, session, msg)
    } catch (err) {
      if (err instanceof RealmError) {
        console.log(err)
        ctx.mqttClose(1003, err.message)
      } else {
        throw err
      }
    }
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
  session.realm.cmdPush(ctx, cmd)
}

handlers.puback = function (ctx, session, message) {
  this.checkRealm(session)
  const qid = session.fetchWaitId(message.messageId)
  if (qid) {
    session.realm.cmdConfirm(ctx, {
      id: qid
    })
    if (session.secureDetails && session.secureDetails.clientId) {
      session.realm.runInboundEvent(
        session.getSid(),
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
  ctx.setSubscribePkg(pkg)
  const afterId = session.getLastPublishedId()
  for (let index=0; index < message.subscriptions.length; index++) {
    const qos = Math.min(message.subscriptions[index].qos, 1)
    pkg.granted[index] = qos
    const uri = mqttParse(message.subscriptions[index].topic)
    const opt = { retainedState: true }
    if (qos > 0) {
      opt.keepTraceFlag = true
    }
    if (afterId) {
      opt.after = afterId
    }
    const cmd = { id: index, uri, opt }
    if (this.checkAuthorize(ctx, cmd, 'subscribe')) {
      session.realm.cmdTrace(ctx, cmd)
    }
  }
}

exports.MqttGate = MqttGate
exports.toMqttPayload = toMqttPayload
exports.parseMqttPayload = parseMqttPayload
