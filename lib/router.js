'use strict'

const tools = require('./tools')
const EventEmitter = require('events').EventEmitter
const Session = require('./session')

class Context {
  constructor (router) {
    this.router = router
  }

  addSession () {

  }

  emit (event, obj, message, data) {
    this.router.emit(event, obj, message, data)
  }
}

class Router extends EventEmitter {
  constructor () {
    super()
    this._sessions = new Map()

    this.on('session.Tx', function (session, data) {
      this.trace('[' + session.sessionId + '] TX > ' + data)
    })

    this.on('session.Rx', function (session, msg) {
      // console.log(this.sessionId, '>', msg)
      this.trace('[' + session.sessionId + '] RX > ' + msg)
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
    return new Context(this)
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

  registerSession (session) {
    if (!this._sessions.has(session.sessionId)) {
      this._sessions.set(session.sessionId, session)
      this._router.emit('connection', session)
    } else {
      throw new Error('session id already registered ' + session.sessionId)
    }
  }

  getSession (sessionId) {
    return this._sessions.get(sessionId)
  }

  removeSession (session) {
    if (this._sessions.has(session.sessionId)) {
      this._sessions.delete(session.sessionId)
    }
  }
}

module.exports = Router
