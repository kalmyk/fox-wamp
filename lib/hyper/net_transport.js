'use strict'

const net = require('net')
const msgpack = require('msgpack-lite')
const { HyperSocketFormatter, RemoteHyperClient } = require('./client')

function FoxNetWriter (socket) {
  this.hyperPkgWrite = function (msg, callback) {
    socket.write(msgpack.encode(msg), callback)
  }

  this.hyperPkgClose = function (code, reason) {
    socket.end()
  }
}

function FoxNetServer (gate, options) {
  const router = gate.getRouter()
  const _server = net.Server(function (socket) {
    const session = router.createSession()
    session.setGateProtocol('hyper.socket')
    const socketWriter = new FoxNetWriter(socket)
    const decodeStream = msgpack.createDecodeStream()

    socket.pipe(decodeStream).on('data', function (msg) {
      const ctx = gate.createContext(session, socketWriter)
      gate.handle(ctx, session, msg)
    })

    socket.on('end', function () {
      console.log('event:socket-end')
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

function FoxNetClient (params) {
  const socket = new net.Socket()
  const socketWriter = new FoxNetWriter(socket)
  const formater = new HyperSocketFormatter(socketWriter)
  RemoteHyperClient.call(this, formater)

  const decoder = new msgpack.Decoder()
  decoder.on('data', (msg) => {
    formater.onMessage(msg)
  })

  const conf = params || {}

  this.onopen = () => {}

  this.connect = () => {
    return new Promise((resolve, reject) => {
      socket.connect(conf.port, conf.host, () => {
        console.log('connect-CB');
        resolve(this)
        this.onopen()
      })

      socket.on('error', (err) => {
        console.log('Connection ERROR', err)
        reject(err)
      })
    })
  }

  socket.on('data', (chunk) => {
    decoder.decode(chunk)
  })

  socket.on('close', () => {
    console.log('event:Connection closed')
  })

  socket.on('end', () => {
    console.log('event:Connection ended')
  })

  this.close = function () {
    socket.end()
  }

  this.getSocket = function () {
    return socket
  }
}

exports.FoxNetServer = FoxNetServer
exports.FoxNetWriter = FoxNetWriter
exports.FoxNetClient = FoxNetClient
