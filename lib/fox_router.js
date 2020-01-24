'use strict'

const metaUser   = require('../ext/metauser')
const WampGate   = require('./wamp/gate')
const MqttGate   = require('./mqtt/gate')
const WampServer = require('./wamp/transport')
const MqttServer = require('./mqtt/transport')
const WsMqttServer = require('./mqtt/ws_transport')
const Router     = require('./router')

class FoxRouter extends Router {
  constructor () {
    super()
    metaUser.registerHandlers(this)
  }

  listenWAMP (wsOptions, authHandler) {
    let gate = new WampGate(this)
    if (authHandler) {
      gate.setAuthHandler(authHandler)
    }
    return new WampServer(gate, wsOptions)
  }

  listenMQTT (wsOptions) {
    let gate = new MqttGate(this)
    return new MqttServer(gate, wsOptions)
  }

  listenWsMQTT (wsOptions) {
    let gate = new MqttGate(this)
    return new WsMqttServer(gate, wsOptions)
  }
}

module.exports = FoxRouter
