'use strict'

const EventEmitter = require('events').EventEmitter

const { REALM_CREATED, SESSION_TX, SESSION_RX, SESSION_WARNING } = require('./messages')
const tools = require('./tools')
const {BaseRealm, BaseEngine} = require('./realm')

class Router extends EventEmitter {
  constructor () {
    super()
    this._realms = new Map()
    this._sessions = new Map()

    // symbol name, perhaps host
    this._id = ''

    this.on(SESSION_TX, function (session, data) {
      this.trace('[' + session.sessionId + '] >', data)
    })

    this.on(SESSION_RX, function (session, msg) {
      this.trace('[' + session.sessionId + '] <', msg)
    })

    this.on('session.debug', function (session, msg) {
      this.trace('[' + session.sessionId + '] ', msg)
    })

    this.on(SESSION_WARNING, function (session, msg, data) {
      this.trace('[' + session.sessionId + ']', msg, data)
    })
    this.setLogTrace(false)
  }

  setId (id) {
    this._id = id
  }

  getId () {
    return this._id
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

  makeSessionId () {
    return tools.randomId()
  }

  registerSession (session) {
    if (!this._sessions.has(session.sessionId)) {
      this._sessions.set(session.sessionId, session)
      this.emit('connection', session)
    } else {
      throw new Error('session id already registered ' + session.sessionId)
    }
  }

  removeSession (session) {
    if (this._sessions.has(session.sessionId)) {
      this._sessions.delete(session.sessionId)
    }
  }

  getSession (sessionId) {
    return this._sessions.get(sessionId)
  }

  getRouterInfo () {
    let result = {}
    if (this._id) {
      result.id = this._id
    }
    return result
  }

  // to be overloaded to create custom engine
  createRealm (realmName) {
    return new BaseRealm(this, new BaseEngine())
  }

  addRealm (realmName, realm) {
    if (this._realms.has(realmName)) {
      throw Error('Realm "'+realmName+'" already set.')
    }
    this._realms.set(realmName, realm)
    realm.getEngine().setRealmName(realmName)
    this.emit(REALM_CREATED, realm, realmName)
  }

  findRealm (realmName) {
    return this._realms.get(realmName)
  }

  getRealm (realmName, callback) {
    if (this._realms.has(realmName)) {
      const realm = this._realms.get(realmName)
      if (typeof callback == 'function') {
        callback(realm)
      }
      return realm
    } else {
      const realm = this.createRealm(realmName)
      this.addRealm(realmName, realm)
      if (typeof callback == 'function') {
        callback(realm)
      }
      return realm
    }
  }
}

module.exports = Router
