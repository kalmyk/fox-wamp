'use strict'

const WebSocket = require('ws')

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
    let data = JSON.stringify(msg)
    router.emit('session.Tx', session, data)
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
  constructor (gate, factory, wsOptions) {
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
      let sender = new WampSender(wsclient, gate.getRouter())
      let session = factory.createSession(gate, sender)

      sender.setSession(session)

      wsclient.on('close', function () {
        session.cleanup()
      })

      wsclient.on('message', function (data) {
        let ctx = factory.createContext()
        ctx.addSession(session)
        try {
          ctx.emit('session.Rx', session, data)
          let msg = JSON.parse(data)
          session.handle(ctx, msg)
        } catch (e) {
          ctx.emit('session.warning', session, 'invalid json', data)
          session.close(1003, 'protocol violation')
          console.log(e)
        }
      })
    })
  }
}

module.exports = WampServer
