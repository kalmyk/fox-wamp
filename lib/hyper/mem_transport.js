'use strict'

function MemSender (memServer, session) {
  var _buffer = []
  memServer.add(this)
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
      session.sender._memClose()
    } else {
      let ctx = memServer._factory.createContext()
      ctx.addSession(session)
      session.handle(ctx, msg)
    }
    return true
  }

  this.close = function () {
    this.send(null)
  }

  this._memClose = function () {
    session.cleanup()
  }
}

function MemServer (factory) {
  let _streams = []
  let _flushRequested = false

  this._factory = factory

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

  this.add = function (pipe) {
    _streams.push(pipe)
  }
}

exports.Sender = MemSender
exports.Server = MemServer
