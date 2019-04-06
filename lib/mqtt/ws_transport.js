'use strict'

const WebSocket = require('ws')
const generate = require('mqtt-packet').generate
const ParserBuild = require('mqtt-packet').parser

function WampSender (wsclient, router) {
  let session

  let defaultCallback = function (error) {
    if (error) {
      router.emit('session.warning', 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }.bind(this)

  this.setSession = function (sendToSession) {
    session = sendToSession
  }

  this.send = function (msg, callback) {
    let data = generate(msg)
    // ?? router.emit('session.Tx', session, data)
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
  constructor (gate, factory, wsOptions) {
    if (!wsOptions.disableProtocolCheck) {
      wsOptions.handleProtocols = function (protocols, request) {
        let i = 0
        while (i < protocols.length) {
          if (protocols[i] === 'mqtt') {
            return 'mqtt'
          }
          i++
        }
        console.log('no known protocol found', protocols)
        return false
      }
    }

    super(wsOptions)

    this.on('connection', function (wsclient) {
      let sender = new WampSender(wsclient, gate.getRouter())
      let session = factory.createSession(gate, sender)
      sender.setSession(session)
      session.protocol = wsclient.protocol

      wsclient.on('close', function () {
        session.cleanup()
      })

      let parser = ParserBuild()

      parser.on('packet', function (msg) {
        // console.log('WS-PACKET ARRIVED', msg)
        let ctx = factory.createContext()
        ctx.addSession(session)
        session.handle(ctx, msg)
      })

      wsclient.on('message', function (data) {
        parser.parse(data)
      })
    })
  }
}

module.exports = WsMqttServer
