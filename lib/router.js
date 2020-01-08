'use strict'

const MSG = require('./messages')
const tools = require('./tools')
const EventEmitter = require('events').EventEmitter
const Session = require('./session')
const Realm = require('./realm').Realm

class Context {
  constructor (router) {
    this.router = router
    this.id = undefined
    this.session = undefined
  }

  addSession (session) {
    this.session = session
  }

  getSession () {
    return this.session
  }

  setId (id) {
    this.id = id
  }

  getId () {
    return this.id
  }

  emit (event, obj, message, data) {
    this.router.emit(event, obj, message, data)
  }
}

class Router extends EventEmitter {
  constructor () {
    super()
    this._realms = new Map()

    this.on('session.Tx', function (session, data) {
      this.trace('[' + session.sessionId + '] TX > ' + data)
    })

    this.on('session.Rx', function (session, msg) {
      // console.log(this.sessionId, '>', msg)
      this.trace('[' + session.sessionId + '] RX < ' + msg)
    })

    this.on('session.debug', function (session, msg) {
      this.trace('[' + session.sessionId + '] ' + msg)
    })

    this.on('session.warning', function (session, msg, data) {
      this.trace('[' + session.sessionId + '] ' + msg + ' ' + data)
    })
    this.setLogTrace(false)
  }

  setLogTrace (trace) {
    if (trace) {
      this.trace = function () {
        console.log.apply(console, arguments)
      }
    } else {
      this.trace = function () {}
    }
  }

  createContext () {
    let ctx = new Context(this)
    // ctx.emit = this.emit
    return ctx
  }

  makeSessionId () {
    return tools.randomId()
  }

  createSession (encoder, sender) {
    return new Session(encoder, sender, this.makeSessionId())
  }

  getRouterInfo () {
    return {}
  }

  createRealm (realmName) {
    return new Realm(this, realmName)
  }

  getRealm (realmName, callback) {
    if (this._realms.has(realmName)) {
      callback(this._realms.get(realmName))
    } else {
      let realm = this.createRealm(realmName)
      this._realms.set(realmName, realm)
      this.emit(MSG.REALM_CREATED, realm, realmName)
      callback(realm)
    }
  }
}

module.exports = Router
