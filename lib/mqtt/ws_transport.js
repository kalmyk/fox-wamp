'use strict'

const WebSocket = require('ws')
const { generate, parser } = require('mqtt-packet')
const { SESSION_TX, SESSION_RX, SESSION_WARNING } = require('../messages')

function MqttSocketWriter (wsclient, session, router) {

  let defaultCallback = (error) => {
    if (error) {
      router.emit(SESSION_WARNING, 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }

  this.mqttPkgWrite = (msg, callback) => {
    router.emit(SESSION_TX, session, msg)
    let data = generate(msg)
    if (wsclient.readyState === WebSocket.OPEN) {
      wsclient.send(
        data,
        (typeof callback === 'function') ? callback : defaultCallback
      )
    }
  }

  this.mqttPkgClose = (code, reason) => {
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
    const router = gate.getRouter()

    this.on('connection', function (wsclient) {
      const session = router.createSession()
      session.setGateProtocol('mqtt.web.socket')
      const mqttSocketWriter = new MqttSocketWriter(wsclient, session, router)

      wsclient.on('close', function () {
        router.removeSession(session)
      })

      let mqttParser = parser()

      mqttParser.on('packet', function (data) {
        router.emit(SESSION_RX, session, data)
        let ctx = gate.createContext(session, mqttSocketWriter)
        gate.handle(ctx, session, msg)
      })

      wsclient.on('message', function (data) {
        mqttParser.parse(data)
      })
    })
  }
}

module.exports = WsMqttServer
