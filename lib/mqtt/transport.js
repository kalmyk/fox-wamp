'use strict'

const net = require('net')
const generate = require('mqtt-packet').generate
const ParserBuild = require('mqtt-packet').parser

function MqttSender (socket, session, router) {
  this.send = function (data) {
    router.emit('session.Tx', session, data)
    socket.write(generate(data))
  }

  this.close = function (code, reason) {
    socket.end()
  }
}

function MqttServer (gate, options) {
  let router = gate.getRouter()
  let _server = net.Server(function (socket) {
    let session = gate.createSession()
    let sender = new MqttSender(socket, session, router)

    let parser = ParserBuild()

    parser.on('packet', function (data) {
      let ctx = gate.createContext(session, sender)
      router.emit('session.Rx', session, data)
      session.handle(ctx, data)
    })

    socket.on('data', function (chunk) {
      parser.parse(chunk)
    })

    socket.on('end', function () {
    })

    socket.on('close', function () {
      session.cleanup()
    })
  })
  _server.listen(options)
}

module.exports = MqttServer
