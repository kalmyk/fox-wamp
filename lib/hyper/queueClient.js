/*jshint node: true */
'use strict';

var
  util = require('util'),
  QUEUE = require('./const'),
  Base = require('./clientBase');

function QueueClient() {
  Base.ClientBase.call(this);

  var
    cmdList = {};

  this.send = function (/* CommandBase */ obj, data)
  {
    var commandId = this.sendCommand(obj.getCommandData(), data);
    cmdList[commandId] = obj;
    return obj.deferred;
  };

  this.handle = function (msg)
  {
    if (msg.id && cmdList[msg.id])
    {
      var wait = cmdList[msg.id];
      if (wait.settle(this, msg))
      {
        delete cmdList[msg.id];
      }
    }
    else {
      // unknown command ID arrived, nothing to do, could write error?
      console.log('UNKNOWN PACKAGE', msg);
    }
  };
}
util.inherits(QueueClient, Base.ClientBase);

function ClientGate() {
  this.handle = function(session, msg) {
//console.log('>c', msg);  
    session.handle(msg);
  }
}

exports.QueueClient = QueueClient;
exports.ClientGate = ClientGate;

QueueClient.prototype.echo = function (data)
{
  return this.send(new Base.Echo(), data);
};

QueueClient.prototype.register = function (queueId, taskCallback)
{
  return this.send(new Base.Register(queueId, taskCallback), undefined);
};

QueueClient.prototype.unRegister = function (queueId)
{
  return this.send(new Base.UnRegister(queueId), undefined);
};

QueueClient.prototype.call = function (queueId, data, callback)
{
  return this.send(new Base.Call(queueId, callback), data);
};

// trace all messages in the queue
QueueClient.prototype.trace = function (queueId, taskCallback, opt)
{
  return this.send(new Base.Trace(queueId, taskCallback, opt), undefined);
};

QueueClient.prototype.unTrace = function (queueId)
{
  return this.send(new Base.UnTrace(queueId), undefined);
};

QueueClient.prototype.push = function (queueId, data, opt)
{
  return this.send(new Base.Push(queueId, opt), data);
};
