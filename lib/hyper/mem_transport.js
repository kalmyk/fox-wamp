'use strict'

const QueueClient  = require('./queueClient')

function SessionMemSender (memServer, client) {
  var _buffer = []
  memServer.addSender(this)

  this.send = function (msg) {
    _buffer.push(msg)
    memServer.requestFlush()
  }

  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false
    }
    var msg = _buffer.shift()
    if (msg === null) {
      client.sender._memClose()
    } else {
      client.handle(msg)
    }
    return true
  }

  this.close = function () {
    this.send(null)
  }
}

function ClientMemSender (memServer, gate, session, sesisonSender) {
  var _buffer = []
  memServer.addSender(this)

  this.send = function (msg) {
    _buffer.push(msg)
    memServer.requestFlush()
  }

  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false
    }

    let msg = _buffer.shift()
    let ctx = gate.createContext(session, sesisonSender)
    gate.handle(ctx, session, msg)

    return true
  }

  this._memClose = function () {
    session.cleanup()
  }
}

function MemServer (gate) {
  let _streams = []
  let _flushRequested = false

  this.requestFlush = function () {
    if (!_flushRequested) {
      _flushRequested = true
      process.nextTick(function () {
        this.processStreams()
      }.bind(this))
    }
  }

  this.processStreams = function () {
    let found

    _flushRequested = false
    found = false
    for (let i = 0; i < _streams.length; i++) {
      found = found || _streams[i].handleBuffer()
    }
    if (found) {
      this.requestFlush()
    }
  }

  this.addSender = function (pipe) {
    _streams.push(pipe)
  }

  this.createClient = function (realm, connectionId) {
    let client = new QueueClient.QueueClient(connectionId)
    let sss = new SessionMemSender(this, client)
    let serverSession = gate.createSession()
    client.sender = new ClientMemSender(this, gate, serverSession, sss)
    realm.joinSession(serverSession)
    return client
  }
}

exports.MemServer = MemServer
