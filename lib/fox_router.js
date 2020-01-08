'use strict'

const metaUser   = require('../ext/metauser')
const WampGate   = require('./wamp/gate')
const MqttGate   = require('./mqtt/gate')
const WampServer = require('./wamp/transport')
const MqttServer = require('./mqtt/transport')
const WsMqttServer = require('./mqtt/ws_transport')
const Router     = require('./router')

class FoxRouter extends Router {
  constructor (authHandler) {
    super()
    this._authHandler = authHandler
    this._sessionList = new Map()
    metaUser.registerHandlers(this)
  }

  listenWAMP (options) {
    let gate = new WampGate(this)
    gate.setAuthHandler(this._authHandler)
    gate.setSessionList(this._sessionList)
    return new WampServer(gate, this, options)
  }

  listenMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    gate.setSessionList(this._sessionList)
    return new MqttServer(gate, this, options)
  }

  listenWsMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    gate.setSessionList(this._sessionList)
    return new WsMqttServer(gate, this, options)
  }
}

module.exports = FoxRouter
