'use strict'

const WebSocket = require('ws')
const { SESSION_TX, SESSION_RX, SESSION_WARNING } = require('../messages')

function WampSender (wsclient, session, router) {
  let defaultCallback = function (error) {
    if (error) {
      router.emit(SESSION_WARNING, session, 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }.bind(this)

  this.send = function (msg, callback) {
    let data = JSON.stringify(msg)
    router.emit(SESSION_TX, session, data)
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

class WampServer extends WebSocket.Server {
  constructor (gate, wsOptions) {
    if (!wsOptions.disableProtocolCheck) {
      // We need to verify that the subprotocol is wamp.2.json
      wsOptions.handleProtocols = function (protocols, request) {
        var i = 0
        while (i < protocols.length) {
          if (protocols[i] === 'wamp.2.json') {
            return 'wamp.2.json'
          }
          i++
        }
        console.log('no known protocol found', protocols)
        return false
      }
    }

    super(wsOptions)

    this.on('connection', function (wsclient) {
      let session = gate.createSession()
      let sender = new WampSender(wsclient, session, gate.getRouter())

      wsclient.on('close', function () {
        session.cleanup()
      })

      wsclient.on('message', function (data) {
        let ctx = gate.createContext(session, sender)
        try {
          ctx.emit(SESSION_RX, data)
          let msg = JSON.parse(data)
          session.handle(ctx, msg)
        } catch (e) {
          ctx.emit(SESSION_WARNING, 'invalid json', data)
          ctx.wampClose(1003, 'protocol violation')
          console.log(e)
        }
      })
    })
  }
}

module.exports = WampServer
