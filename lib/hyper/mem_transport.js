'use strict'

let memTransport

function MemSender (session) {
  var _buffer = []
  memTransport.add(this)
  this.send = function (msg) {
    _buffer.push(msg)
    memTransport.requestFlush()
  }
  this.handleBuffer = function () {
    if (_buffer.length === 0) {
      return false
    }
    var msg = _buffer.shift()
    if (msg === null) {
      session.sender._memClose()
    } else {
      session.handle(msg)
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

function MemTransport () {
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

  this.add = function (pipe) {
    _streams.push(pipe)
  }
}

memTransport = new MemTransport()

exports.Sender = MemSender
