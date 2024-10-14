'use strict'

const util = require('util')
const net = require('net')
const msgpack = require('msgpack-lite')
const { SESSION_TX, SESSION_RX } = require('../messages')
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
    const session = router.createSession()
    session.setGateProtocol('hyper.socket')
    const sender = new ServerNetSender(socket, session, router)
    const decodeStream = msgpack.createDecodeStream()

    socket.pipe(decodeStream).on('data', function (msg) {
      const ctx = gate.createContext(session, sender)
      router.emit(SESSION_RX, session, JSON.stringify(msg))
      gate.handle(ctx, session, msg)
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
      client.onMessage(msg)
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
