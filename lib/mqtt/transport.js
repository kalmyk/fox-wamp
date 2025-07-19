'use strict'

const net = require('net')
const generate = require('mqtt-packet').generate
const ParserBuild = require('mqtt-packet').parser
const { SESSION_TX } = require('../messages')

function MqttWebSocketWriter (socket, session, router) {
  this.mqttPkgWrite = (data) => {
    router.emit(SESSION_TX, session, data)
    socket.write(generate(data))
  }

  this.mqttPkgClose = () => {
    socket.end()
  }
}

function listenMqttServer (gate, options) {
  const router = gate.getRouter()
  const _server = net.Server(function (socket) {
    const session = router.createSession()
    session.setGateProtocol('mqtt.socket')
    const socketWriter = new MqttWebSocketWriter(socket, session, router)

    const parser = ParserBuild()

    parser.on('packet', function (data) {
      const ctx = gate.createContext(session, socketWriter)
      router.emit('session.Rx', session, data)
      gate.handle(ctx, session, data)
    })

    socket.on('data', function (chunk) {
      parser.parse(chunk)
    })

    socket.on('end', function () {
    })

    socket.on('close', function () {
      router.removeSession(session)
    })

    socket.on('error', function (exc) {
      console.log("ignoring exception:" + exc, session.getSid())
    })
  })
  _server.listen(options)
}

module.exports = listenMqttServer
