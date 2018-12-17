/*jshint node: true */
'use strict';

var memTransport;

function MemSender(session) {
  var _buffer = [];
  memTransport.add(this);
  this.send = function (msg) {
    _buffer.push(msg);
    memTransport.requestFlush();
  };
  this.handleBuffer = function () {
    if (_buffer.length === 0)
        return false;
    var msg = _buffer.shift();
    if (null === msg) {
      session.sender._memClose();
    }
    else {
      session.handle(msg);
    }
    return true;
  };
  this.close = function () {
    this.send(null);
  };
  this._memClose = function () {
    session.cleanup();
  };
}

function MemTransport() {
  var _streams = [];
  var _isFlush = false;
  var _flushRequested = false;

  this.requestFlush = function () {
    if (!_flushRequested) {
      _flushRequested = true;
      process.nextTick(function () {
        this.processStreams();
      }.bind(this));
    }
  };
  this.processStreams = function () {
    var i, found;

    _flushRequested = false;
    found = false;
    for (i=0; i < _streams.length; i++) {
      found = found || _streams[i].handleBuffer();
    }
    if (found) {
      this.requestFlush();
    }
  };
  this.add = function (pipe) {
    _streams.push(pipe);
  };
}

memTransport = new MemTransport();

exports.Sender = MemSender;
