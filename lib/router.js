'use strict'

const tools = require('./tools')
const EventEmitter = require('events').EventEmitter
const Session = require('./session')

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
}

module.exports = Router
