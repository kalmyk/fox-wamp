/*jshint node: true */
'use strict';

var
  inherits = require('util').inherits,
  QUEUE = require('./const.js');

function Task(taskResponseCallback, request) {
  this.taskResponseCallback = taskResponseCallback;
  this.cmd = request;
  this.isFinished = false;
}

Task.prototype.getUri = function()
{
  return this.cmd.uri;
};

Task.prototype.getId = function()
{
  if (this.cmd.hasOwnProperty('qid'))
    return this.cmd.qid;
  else
    return 0;
};

Task.prototype.getOpt = function()
{
  return this.cmd.opt;
};

Task.prototype.markSegment = function()
{
  if (this.cmd.hasOwnProperty(QUEUE.PKG_SEGMENT))
    return this.cmd[QUEUE.PKG_SEGMENT];
  else
    return 0;
};

Task.prototype.resolve = function(result)
{
  if (!this.isFinished)
  {
    this.isFinished = true;
    this.taskResponseCallback(this.cmd, QUEUE.RES_OK, result);
    this.cmd = null;
  }
};

Task.prototype.reject = function(reason)
{
  if (!this.isFinished)
  {
    this.isFinished = true;
    this.taskResponseCallback(this.cmd, QUEUE.RES_ERR, reason);
    this.cmd = null;
  }
};

Task.prototype.notify = function(status)
{
  if (!this.isFinished)
  {
    this.taskResponseCallback(this.cmd, QUEUE.RES_EMIT, status);
  }
};

function CommandBase(command)
{
  let doResolve, doReject;
  this.command = command;
  this.deferred = new Promise((resolve, reject) => {
    doResolve = resolve;
    doReject = reject;
  });
  this.resolve = function (result) {
    doResolve(result);
  };
  this.reject = function (reason) {
    doReject(reason);
  };
}

CommandBase.prototype.then = function (/* ALL is CommandBase */ atResolve, atReject, atProgress)
{
  if (!this.command[QUEUE.PKG_STACK])
    this.command[QUEUE.PKG_STACK] = {};
  if (atResolve)
    this.command[QUEUE.PKG_STACK][QUEUE.RES_OK] = atResolve.getCommandData();
  if (atReject)
    this.command[QUEUE.PKG_STACK][QUEUE.RES_ERR] = atReject.getCommandData();
  if (atProgress)
    this.command[QUEUE.PKG_STACK][QUEUE.RES_EMIT] = atProgress.getCommandData();  // TODO: move recursion to send
};

CommandBase.prototype.getCommandData = function ()
{
  return this.command;
};

// data could be array, task or request
CommandBase.prototype.settle = function(client, cmd)
{
  var mode = cmd.rsp || '';
  switch (mode)
  {
    case QUEUE.RES_ACK:  this.resolve(cmd.data); return false;
    case QUEUE.RES_OK:   this.resolve(cmd.data); return true;
    case QUEUE.RES_ERR:  this.reject (cmd.data); return true;
    case QUEUE.RES_EMIT: if (this.callback) this.callback(cmd.data); return false;
    case QUEUE.RES_TASK:
    case QUEUE.RES_EVENT:
      if (this.callback) {
        var task = new Task(client.sendTaskResponse, cmd);
        this.callback(cmd.data, task);
      }
      return false;
  default:
    this.reject(cmd.data);
    return true;
  }
};

function Echo() {
  var command = {};
  command.ft = 'ECHO';
  CommandBase.call(this, command);
}
inherits(Echo, CommandBase);

function Register(uri, callback)
{
  var command = {};
  command.ft = 'REG';
  command.uri = uri;
  CommandBase.call(this, command);
  this.callback = callback;
}
inherits(Register, CommandBase);

function UnRegister(registration)
{
  var command = {};
  command.ft = 'UNREG';
  command.unr = registration;
  CommandBase.call(this, command);
}
inherits(UnRegister, CommandBase);

function Call(uri, callback)
{
  var command = {};
  command.ft = 'CALL';
  command.uri = uri;
  this.callback = callback;
  CommandBase.call(this, command);
}
inherits(Call, CommandBase);

function Trace(uri, callback, opt)
{
  var command = {};
  command.ft = 'TRACE';
  command.uri = uri;
  command.opt = opt;
  CommandBase.call(this, command);
  this.callback = callback;
}
inherits(Trace, CommandBase);

function UnTrace(trace)
{
  var command = {};
  command.ft = 'UNTRACE';
  command.unr = trace;
  CommandBase.call(this, command);
}
inherits(UnTrace, CommandBase);

function Push(uri, opt)
{
  var command = {};
  command.ft = 'PUSH';
  command.uri = uri;
  command.ack = true;
  command.opt = opt;
  CommandBase.call(this, command);
}
inherits(Push, CommandBase);

function ClientBase() {
  var
    commandId = 0,
    that = this;

    this.sender = null;

  this.sendCommand = function (command, data)
  {
    commandId++;
    command.id = commandId;
    if (undefined !== data) {
      command.data = data;
    }
    
    this.sender.send(command);
    return commandId;
  };

  function _sendTaskResponse(request, responseMode, data)
  {
    if (!request.qid) // no response needed
      return false;

    var header = {};
    header.qid = request.qid;
    header.rsp = responseMode;
    header.data = data;
    if (request.rsp === QUEUE.RES_EVENT) {
      header.ft = 'CONFIRM';  // event confirmed
    }
    else {
      header.ft = 'YIELD';   // task resolved
    }

    that.sender.send(header);
  }
  this.sendTaskResponse = _sendTaskResponse;

  this.close = function()
  {
    console.log("ClientBase: TODO: implement close connection");
  };
}

exports.CommandBase = CommandBase;
exports.Echo = Echo;
exports.Register = Register;
exports.UnRegister = UnRegister;
exports.Call = Call;
exports.Trace = Trace;
exports.UnTrace = UnTrace;
exports.Push = Push;

exports.Task = Task;
exports.ClientBase = ClientBase;
