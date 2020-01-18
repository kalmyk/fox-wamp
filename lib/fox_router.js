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
    metaUser.registerHandlers(this)
  }

  listenWAMP (options) {
    let gate = new WampGate(this)
    gate.setAuthHandler(this._authHandler)
    return new WampServer(gate, options)
  }

  listenMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    return new MqttServer(gate, options)
  }

  listenWsMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    return new WsMqttServer(gate, options)
  }
}

module.exports = FoxRouter
