'use strict'

const net = require('net')
const generate = require('mqtt-packet').generate
const ParserBuild = require('mqtt-packet').parser

function MqttSender (socket) {
  this.send = function (msg) {
    socket.write(generate(msg))
  }

  this.close = function (code, reason) {
    socket.end()
  }
}

function MqttServer (gate, factory, options) {
  let _server = net.Server(function (socket) {
    let sender = new MqttSender(socket)
    let session = factory.createSession(gate, sender)

    let parser = ParserBuild()

    parser.on('packet', function (msg) {
      // console.log('PACKET ARRIVED', msg)
      let ctx = factory.createContext()
      ctx.addSession(session)
      session.handle(ctx, msg)
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
