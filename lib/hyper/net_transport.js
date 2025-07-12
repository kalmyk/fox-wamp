'use strict'

const net = require('net')
const msgpack = require('msgpack-lite')
const { SESSION_TX, SESSION_RX, SESSION_DEBUG } = require('../messages')
const { HyperSocketFormatter, RemoteHyperClient } = require('./client')

function HyperNetWriter (socket, session, router) {
  this.hyperPkgWrite = (msg, callback) => {
    const pkg = msgpack.encode(msg)
    // router.emit(SESSION_TX, session, pkg)
    socket.write(pkg, callback)
  }
  this.hyperPkgClose = (code, reason) => {
    router.emit(SESSION_DEBUG, session, 'Closing NetSocket connection: [' + code + '] ' + reason)
    socket.end()
  }
}

function HyperNetServer (gate, options) {
  const router = gate.getRouter()
  const _server = net.Server(function (socket) {
    const session = router.createSession()
    session.setGateProtocol('hyper.net')
    const socketWriter = new HyperNetWriter(socket, session, router)
    const decodeStream = msgpack.createDecodeStream()

    socket.pipe(decodeStream).on('data', function (msg) {
      const ctx = gate.createContext(session, socketWriter)
      // ctx.emit(SESSION_RX, session, msg)
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

/** HyperNetClient is a client for HyperNet protocol over TCP.
  * param {Object} params - configuration parameters
  * @param {string} params.host - host to connect to
  * @param {number} params.port - port to connect to
  * @param {number} [params.maxReconnectAttempts=-1] - maximum number of reconnect attempts, -1 means infinite
  * @param {number} [params.reconnectDelay=1000] - delay between reconnect attempts in milliseconds
  */
function HyperNetClient (params) {
  const socket = new net.Socket()
  const socketWriter = new HyperNetWriter(socket, null, this)
  const formater = new HyperSocketFormatter(socketWriter)
  RemoteHyperClient.call(this, formater)

  const decoder = new msgpack.Decoder()
  decoder.on('data', (msg) => {
    formater.onMessage(msg)
  })

  const conf = params || {}
  let reconnectAttempts = 0
  let maxReconnectAttempts = conf.maxReconnectAttempts || -1
  let reconnectDelay = conf.reconnectDelay || 1000
  let isClosing = false

  socket.on('connect', () => {
    console.log('HyperNetClient:Connection established')
    reconnectAttempts = 0
    if (typeof socket._connectResolve === 'function') {
      socket._connectResolve(this)
      socket._connectResolve = null
    }
    this.applyOnOpen()
  })

  const doConnect = (resolve, reject) => {
    socket._connectResolve = resolve
    socket.connect(conf.port, conf.host)
  }

  socket.on('error', (err) => {
    if (isClosing) return
    console.log('HyperNetClient:Connection ERROR', err)
  })

  this.connect = () => {
    isClosing = false
    return new Promise((resolve, reject) => {
      doConnect(resolve, reject)
    })
  }

  socket.on('timeout', () => {
    console.log('HyperNetClient:Connection timeout')
  })

  socket.on('drain', () => {
    console.log('HyperNetClient:Socket drained')
  })

  socket.on('data', (chunk) => {
    decoder.decode(chunk)
  })

  socket.on('close', () => {
    console.log('HyperNetClient:Connection closed')
    if (isClosing) return
    if (maxReconnectAttempts < 0 || reconnectAttempts < maxReconnectAttempts) {
      reconnectAttempts++
      console.log('Reconnecting...');
      setTimeout(() => {
        this.connect().catch(() => {})
      }, reconnectDelay)
    }
  })

  socket.on('end', () => {
    console.log('HyperNetClient:Connection ended')
  })

  this.close = function () {
    isClosing = true
    socket.end()
  }

  this.getSocket = function () {
    return socket
  }

  this.emit = () => {}
}

exports.HyperNetServer = HyperNetServer
exports.HyperNetWriter = HyperNetWriter
exports.HyperNetClient = HyperNetClient
