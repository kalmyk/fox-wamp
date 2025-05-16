'use strict'

const net = require('net')
const msgpack = require('msgpack-lite')
const { HyperSocketFormatter, RemoteHyperClient } = require('./client')

function FoxNetSocketWriter (socket) {
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
    const socketWriter = new FoxNetSocketWriter(socket)
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

async function hyperConnect (params) {
  const socket = new net.Socket()
  const decoder = new msgpack.Decoder()
  const socketWriter = new FoxNetSocketWriter(socket)
  const formater = new HyperSocketFormatter(socketWriter)

  decoder.on('data', (msg) => {
    formater.onMessage(msg)
  })

  return new Promise((resolve, reject) => {
    socket.connect(params.port, params.host, () => {
      console.log('connect-CB')
    })

    socket.on('error', (err) => {
      console.log('Connection ERROR', err)
      reject(err)
      // setTimeout(this.connect, 2000)
    })

    socket.on('connect', () => {
      console.log('EVENT-CONNECT')
      resolve(new RemoteHyperClient(formater))
    })
    socket.on('data', (chunk) => {
      decoder.decode(chunk)
    })
    socket.on('close', () => {
      console.log('event:Connection closed')
    })
    socket.on('end', () => {
      console.log('event:Connection ended')
    })

  })
}

exports.FoxNetServer = FoxNetServer
exports.hyperConnect = hyperConnect
exports.FoxNetSocketWriter = FoxNetSocketWriter
