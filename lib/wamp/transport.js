'use strict'

const WebSocket = require('ws')

function WampSender (wsclient, router) {
  let session

  var defaultCallback = function (error) {
    if (error) {
      router.emit('session.warning', 'Failed to send message:', error)
      this.close(1011, 'Unexpected error')
    }
  }.bind(this)

  this.setSession = function (sendToSession) {
    session = sendToSession
  }

  this.send = function (msg, callback) {
    if (wsclient.readyState === WebSocket.OPEN) {
      var data = JSON.stringify(msg)
      router.emit('session.Tx', session, data)
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

function WampServer (gate, SessionClass, wsOptions) {
  let router = gate.getRouter()
  let sessionList

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
    }
  }

  var _wss = new WebSocket.Server(wsOptions)

  _wss.on('connection', function (wsclient) {
    var sender = new WampSender(wsclient, gate.getRouter())
    var session = new SessionClass(gate.getEncoder(), sender, gate.makeSessionId())

    sender.setSession(session)
    if (sessionList) {
      sessionList.registerSession(session)
    }

    wsclient.on('close', function () {
      if (sessionList) {
        sessionList.removeSession(session)
      }
      session.cleanup()
    })

    wsclient.on('message', function (data) {
      var msg
      try {
        router.emit('session.Rx', session, data)
        msg = JSON.parse(data)
        gate.handle(session, msg)
      } catch (e) {
        router.emit('session.warning', session, 'invalid json', data)
        session.close(1003, 'protocol violation')
        console.log(e)
      }
    })
  })

  this.close = function () {
    _wss.close()
  }

  this.setSessionList = function (list) {
    sessionList = list
  }
}

module.exports = WampServer
