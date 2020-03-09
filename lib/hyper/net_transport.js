'use strict'

const util = require('util')
const net = require('net')
const msgpack = require('msgpack-lite')
const { SESSION_TX, SESSION_RX, SESSION_WARNING } = require('../messages')
const QueueClient = require('./queueClient').QueueClient

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
  const router = gate.getRouter()
  const _server = net.Server(function (socket) {
    const session = gate.createSession()
    const sender = new ServerNetSender(socket, session, router)
    const decodeStream = msgpack.createDecodeStream()

    socket.pipe(decodeStream).on('data', function (msg) {
      const ctx = gate.createContext(session, sender)
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

function ClientSocket (params) {
  QueueClient.call(this)
  const socket = new net.Socket()
  let client
  let decoder

  socket.on('data', (chunk) => {
    decoder.decode(chunk)
  })

  socket.on('close', () => {
    console.log('Connection closed')
    setTimeout(this.connect, 2000)
  })

  socket.on('end', () => {
    console.log('Connection ended')
  })

  socket.on('error', (err) => {
    console.log('Connection ERROR', err)
    // setTimeout(this.connect, 2000)
  })

  socket.on('connect', () => {
    console.log('EVENT-CONNECT')
    client = new QueueClient()
    client.sender = new ClientNetSender(socket)

    decoder = new msgpack.Decoder()
    decoder.on('data', (msg) => {
      client.handle(msg)
    })
    this.onopen(client)
  })

  this.onopen = () => {}

  this.connect = () => {
    socket.connect(params.port, params.host)
  }
}
util.inherits(ClientSocket, QueueClient)

exports.NetServer = NetServer
exports.ClientSocket = ClientSocket
