'use strict'

const {HyperClient, HyperApiContext, HyperSocketFormatter} = require('./client')

// receive events
function SessionMemListener (memServer, transport) {
  let _buffer = []
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
    if (msg === null) {
      transport.sender._memClose()
    } else {
      transport.onMessage(msg)
    }
    return true
  }

  this.close = function () {
    this.send(null)
  }
}

function RealmAdapter (memServer, gate, session) {
  let _buffer = []
  let listener = null
  memServer.addSender(this)

  this.setListener = function (_listener) {
    listener = _listener
  }

  this.send = function (msg) {
    _buffer.push(msg)
    memServer.requestFlush()
  }

  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false
    }

    let msg = _buffer.shift()
    let ctx = gate.createContext(session, listener)
    gate.handle(ctx, session, msg)

    return true
  }

  this._memClose = function () {
    gate.getRouter().removeSession(session)
  }
}

function MemServer (gate) {
  let _streams = []
  let _flushRequested = false

  this.requestFlush = function () {
    if (!_flushRequested) {
      _flushRequested = true
      process.nextTick(() => this.processStreams())
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

  this.createClient = function (realm) {
    const session = gate.getRouter().createSession()
    session.setGateProtocol('inmemory.hyper')
    realm.joinSession(session)
    const realmAdapter = new RealmAdapter(this, gate, session)
    const listener = new SessionMemListener(this, realmAdapter)
    const clientFormater = new HyperSocketFormatter(realmAdapter)

    realmAdapter.setListener({ hyperPkgWrite: clientFormater.onMessage }) // zero pipe

    let client = new HyperClient(
      clientFormater,
      listener
    )
    client.session = session
    return client
  }
}

exports.MemServer = MemServer
