'use strict'

const MSG        = require('./messages')
const metaUser   = require('../ext/metauser')
const Realm      = require('./realm').Realm
const WampGate   = require('./wamp/gate')
const MqttGate   = require('./mqtt/gate')
const WampServer = require('./wamp/transport')
const MqttServer = require('./mqtt/transport')
const WsMqttServer = require('./mqtt/ws_transport')
const Router     = require('./router')

class FoxRouter extends Router {
  constructor (authHandler) {
    super()
    this._realms = new Map()
    this._authHandler = authHandler
    metaUser.registerHandlers(this)
  }

  getRealm (realmName, callback) {
    if (this._realms.has(realmName)) {
      callback(this._realms.get(realmName))
    } else {
      let realm = new Realm(this)
      this._realms.set(realmName, realm)
      this.emit(MSG.REALM_CREATED, realm, realmName)
      callback(realm)
    }
  }

  listenWAMP (options) {
    let gate = new WampGate.WampHandler(this, new WampGate.WampEncoder())
    gate.setAuthHandler(this._authHandler)
    return new WampServer(gate, this, options)
  }

  listenMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    return new MqttServer(gate, this, options)
  }

  listenWsMQTT (options) {
    let gate = new MqttGate(this)
    gate.setAuthHandler(this._authHandler)
    return new WsMqttServer(gate, this, options)
  }
}

module.exports = FoxRouter
