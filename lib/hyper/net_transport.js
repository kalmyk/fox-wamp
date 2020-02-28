'use strict'

const net = require('net')
const msgpack = require('msgpack-lite')
const { SESSION_TX, SESSION_RX, SESSION_WARNING } = require('../messages')

function ServerNetSender (socket, session, router) {
  // var encodeStream = msgpack.createEncodeStream()
  // encodeStream.pipe(socket)
  this.send = function (msg, callback) {
    router.emit(SESSION_TX, session, JSON.stringify(msg))
    socket.write(msgpack.encode(msg))
    // encodeStream.write(msg);
    // encodeStream.end(); does not sending without end, but disconnections
  }

  this.close = function (code, reason) {
    socket.end()
  }
}

function NetServer (gate, options) {
  let router = gate.getRouter()
  let _server = net.Server(function (socket) {
    let session = gate.createSession()
    let sender = new ServerNetSender(socket, session, router)
    let decodeStream = msgpack.createDecodeStream()

    socket.pipe(decodeStream).on('data', function (msg) {
      let ctx = gate.createContext(session, sender)
      try {
        router.emit(SESSION_RX, session, JSON.stringify(msg))
        session.handle(ctx, msg)
      } catch (e) {
        router.emit(SESSION_WARNING, session, 'invalid message', msg)
        session.close(1003, 'protocol violation')
        console.log(e)
      }
    })

    socket.on('end', function () {
    })

    socket.on('close', function () {
      session.cleanup()
    })
  })
  _server.listen(options)

  return _server
}

function ClientNetSender (socket) {
  this.send = function (msg, callback) {
    socket.write(msgpack.encode(msg))
  }

  this.close = function (code, reason) {
    socket.end()
  }
}

function createClientSocket (client) {
  var socket = new net.Socket()
  var sender = new ClientNetSender(socket)
  client.sender = sender

  let decodeStream = msgpack.createDecodeStream()

  socket.pipe(decodeStream).on('data', function (msg) {
    client.handle(msg)
  })
  return socket
}

exports.NetServer = NetServer
exports.createClientSocket = createClientSocket
