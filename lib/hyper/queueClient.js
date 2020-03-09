'use strict'

const util = require('util')
const Base = require('./clientBase')

function QueueClient (connectionId) {
  Base.ClientBase.call(this);

  let cmdList = {}

  this.send = function (/* CommandBase */ obj, data) {
    var commandId = this.sendCommand(obj.getCommand(), data)
    cmdList[commandId] = obj
    return obj.deferred
  }

  this.handle = function (msg) {
    if (msg.id && cmdList[msg.id]) {
      var wait = cmdList[msg.id]
      if (wait.settle(this, msg)) {
        delete cmdList[msg.id]
      }
    } else {
      // unknown command ID arrived, nothing to do, could write error?
      console.log((connectionId ? `[${connectionId}] ` : '') + 'UNKNOWN PACKAGE', msg);
    }
  };
}
util.inherits(QueueClient, Base.ClientBase);

exports.QueueClient = QueueClient

QueueClient.prototype.login = function (attr) {
  return this.send(new Base.Login(attr))
}

QueueClient.prototype.echo = function (data) {
  return this.send(new Base.Echo(), data)
}

QueueClient.prototype.register = function (uri, taskCallback) {
  return this.send(new Base.Register(uri, taskCallback), undefined)
}

QueueClient.prototype.unRegister = function (uri) {
  return this.send(new Base.UnRegister(uri), undefined)
}

QueueClient.prototype.call = function (uri, data, callback) {
  return this.send(new Base.Call(uri, callback), data)
}

// trace all messages in the queue
QueueClient.prototype.trace = function (uri, taskCallback, opt) {
  return this.send(new Base.Trace(uri, taskCallback, opt), undefined)
}

QueueClient.prototype.unTrace = function (uri) {
  return this.send(new Base.UnTrace(uri), undefined)
}

QueueClient.prototype.push = function (uri, data, opt) {
  return this.send(new Base.Push(uri, opt), data)
}
