'use strict'

const WebSocket = require('ws')
const msgpack = require('msgpack-lite')
const { SESSION_TX, SESSION_RX, SESSION_DEBUG } = require('../messages')
const { HyperSocketFormatter, RemoteHyperClient } = require('./client')

function HyperWSWriter(wsclient, session, router) {
  this.hyperPkgWrite = function (msg, callback) {
    const pkg = msgpack.encode(msg)
    router.emit(SESSION_TX, session, pkg)
    wsclient.send(pkg, callback)
  }
  this.hyperPkgClose = function (code, reason) {
    router.emit(SESSION_DEBUG, session, 'Closing WebSocket connection: [' + code + '] ' + reason)
    wsclient.close(code, reason)
  }
}

function HyperWSServer(gate, options) {
  const router = gate.getRouter()
  const wss = new WebSocket.Server(options)

  wss.on('connection', function (ws) {
    const session = router.createSession()
    session.setGateProtocol('hyper.ws')
    const socketWriter = new HyperWSWriter(ws, session, router)

    ws.on('message', function (data) {
      ctx.emit(SESSION_RX, data.toString('utf-8'))
      let msg
      try {
        msg = msgpack.decode(data)
      } catch (e) {
        console.error('Failed to decode msgpack:', e)
        return
      }
      const ctx = gate.createContext(session, socketWriter)
      gate.handle(ctx, session, msg)
    })

    ws.on('close', function () {
      router.removeSession(session)
    })

    ws.on('error', function (exc) {
      console.log("ignoring exception:" + exc, session.getSid())
    })
  })

  return wss
}

function HyperWSClient(params) {
  const conf = params || {}
  let ws
  let socketWriter
  let formater

  RemoteHyperClient.call(this, null)

  this.connect = () => {
    return new Promise((resolve, reject) => {
      ws = new WebSocket(`ws://${conf.host}:${conf.port}`)
      ws.binaryType = 'arraybuffer'

      ws.onopen = () => {
        socketWriter = new HyperWSWriter(ws)
        formater = new HyperSocketFormatter(socketWriter)
        this.formater = formater
        resolve(this)
        this.applyOnOpen()
      }

      ws.onmessage = (event) => {
        let msg
        try {
          msg = msgpack.decode(Buffer.from(event.data))
        } catch (e) {
          console.error('Failed to decode msgpack:', e)
          return
        }
        formater.onMessage(msg)
      }

      ws.onerror = (err) => {
        console.log('Connection ERROR', err)
        reject(err)
      }

      ws.onclose = () => {
        console.log('event:Connection closed')
      }
    })
  }

  this.close = function () {
    if (ws) ws.close()
  }

  this.getSocket = function () {
    return ws
  }
}

exports.HyperWSServer = HyperWSServer
exports.HyperWSWriter = HyperWSWriter
exports.HyperWSClient = HyperWSClient
