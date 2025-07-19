'use strict'

const WebSocket = require('ws')
const { SESSION_TX, SESSION_RX, SESSION_ALERT, SESSION_DEBUG } = require('../messages')

function WampSocketWriter (wsclient, session, router) {
  let defaultCallback = function (error) {
    if (error) {
      router.emit(SESSION_ALERT, session, 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }.bind(this)

  this.wampPkgWrite = function (msg, callback) {
    let data = JSON.stringify(msg)
    router.emit(SESSION_TX, session, data)
    if (wsclient.readyState === WebSocket.OPEN) {
      wsclient.send(
        data,
        (typeof callback === 'function') ? callback : defaultCallback
      )
    }
  }

  this.wampPkgClose = function (code, reason) {
    router.emit(SESSION_DEBUG, session, 'Closing WebSocket connection: [' + code + '] ' + reason)
    wsclient.close(code, reason)
  }
}

class WampServer extends WebSocket.Server {
  constructor (gate, wsOptions) {
    if (!wsOptions.disableProtocolCheck) {
      // We need to verify that the subprotocol is wamp.2.json
      wsOptions.handleProtocols = function (protocols, request) {
        if (protocols.has('wamp.2.json')) {
          return 'wamp.2.json'
        }
        console.log('[wamp.2.json] protocol not found', protocols)
        return false
      }
    }

    super(wsOptions)

    this.on('connection', function (wsclient) {
      const session = gate.getRouter().createSession()
      session.setGateProtocol('wamp.2.json')
      let sender = new WampSocketWriter(wsclient, session, gate.getRouter())

      wsclient.on('close', function () {
        gate.getRouter().removeSession(session)
      })

      wsclient.on('message', function (data) {
        let ctx = gate.createContext(session, sender)
        try {
          ctx.emit(SESSION_RX, data.toString('utf-8'))
          let msg = JSON.parse(data)
          gate.handle(ctx, session, msg)
        } catch (e) {
          ctx.emit(SESSION_ALERT, 'invalid json', data)
          ctx.wampClose(1003, 'protocol violation')
          console.log(e)
        }
      })
    })
  }
}

module.exports = WampServer
