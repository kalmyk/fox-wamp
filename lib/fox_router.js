'use strict'

const metaUser      = require('../ext/metauser')
const WampGate      = require('./wamp/gate')
const MqttGate      = require('./mqtt/gate')
const WampServer    = require('./wamp/transport')
const MqttServer    = require('./mqtt/transport')
const WsMqttServer  = require('./mqtt/ws_transport')
const Router        = require('./router')
const { MemBinder } = require('./mono/membinder')

class FoxRouter extends Router {
  constructor () {
    super(new MemBinder())
    metaUser.registerHandlers(this)
  }

  listenWAMP (wsOptions, authHandler) {
    const gate = new WampGate(this)
    if (authHandler) {
      gate.setAuthHandler(authHandler)
    }
    return new WampServer(gate, wsOptions)
  }

  listenMQTT (wsOptions, authHandler) {
    const gate = new MqttGate(this)
    if (authHandler) {
      gate.setAuthHandler(authHandler)
    }
    return new MqttServer(gate, wsOptions)
  }

  listenWsMQTT (wsOptions, authHandler) {
    const gate = new MqttGate(this)
    if (authHandler) {
      gate.setAuthHandler(authHandler)
    }
    return new WsMqttServer(gate, wsOptions)
  }
}

module.exports = FoxRouter
