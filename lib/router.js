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
    this.router.emit(event, message, obj, data)
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

  newContext () {
    return new Context(this)
  }

  makeSessionId () {
    return tools.randomId()
  }

  newSession (encoder, sender) {
    return new Session(encoder, sender, this.makeSessionId())
  }
}

module.exports = Router
