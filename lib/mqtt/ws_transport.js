'use strict'

const WebSocket = require('ws')
const { generate, parser } = require('mqtt-packet')
const { SESSION_TX, SESSION_RX, SESSION_WARNING } = require('../messages')

function WampSender (wsclient, session, router) {

  let defaultCallback = function (error) {
    if (error) {
      router.emit(SESSION_WARNING, 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }.bind(this)

  this.send = function (msg, callback) {
    router.emit(SESSION_TX, session, msg)
    let data = generate(msg)
    if (wsclient.readyState === WebSocket.OPEN) {
      wsclient.send(
        data,
        (typeof callback === 'function') ? callback : defaultCallback
      )
    }
  }

  this.close = function (code, reason) {
    router.emit('session.debug', session, 'Closing WebSocket connection: [' + code + '] ' + reason)
    wsclient.close(code, reason)
  }
}

class WsMqttServer extends WebSocket.Server {
  constructor (gate, wsOptions) {
    if (!wsOptions.disableProtocolCheck) {
      wsOptions.handleProtocols = function (protocols, request) {
        if (protocols.has('mqtt')) {
          return 'mqtt'
        }
        console.log('[mqtt] protocol not found', protocols)
        return false
      }
    }

    super(wsOptions)
    let router = gate.getRouter()

    this.on('connection', function (wsclient) {
      let session = gate.createSession()
      let sender = new WampSender(wsclient, session, router)

      wsclient.on('close', function () {
        gate.removeSession(session)
      })

      let mqttParser = parser()

      mqttParser.on('packet', function (data) {
        router.emit(SESSION_RX, session, data)
        let ctx = gate.createContext(session, sender)
        session.handle(ctx, data)
      })

      wsclient.on('message', function (data) {
        mqttParser.parse(data)
      })
    })
  }
}

module.exports = WsMqttServer
