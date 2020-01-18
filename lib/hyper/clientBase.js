'use strict'

const inherits = require('util').inherits
const { RESULT_OK, RESULT_ACK, RESULT_EMIT, RESULT_ERR,
  REQUEST_TASK, REQUEST_EVENT } = require('../messages')
const { wampParse, restoreUri } = require('../topic_pattern')

function Task(taskResponseCallback, request) {
  this.taskResponseCallback = taskResponseCallback;
  this.cmd = request;
  this.isFinished = false;
}

Task.prototype.getUri = function ()
{
  return this.cmd.uri;
};

Task.prototype.getTopic = function ()
{
  return restoreUri(this.cmd.uri);
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

Task.prototype.resolve = function(result) {
  if (!this.isFinished) {
    this.isFinished = true;
    this.taskResponseCallback(this.cmd, RESULT_OK, result);
    this.cmd = null;
  }
};

Task.prototype.reject = function (reason) {
  if (!this.isFinished) {
    this.isFinished = true
    this.taskResponseCallback(this.cmd, RESULT_ERR, reason)
    this.cmd = null
  }
}

Task.prototype.notify = function (data) {
  if (!this.isFinished) {
    this.taskResponseCallback(this.cmd, RESULT_EMIT, data)
  }
}

function CommandBase (command) {
  let doResolve, doReject
  this.command = command
  this.deferred = new Promise((resolve, reject) => {
    doResolve = resolve
    doReject = reject
  })

  this.resolve = function (result) {
    doResolve(result)
  }

  this.reject = function (reason) {
    doReject(reason)
  }
}

CommandBase.prototype.getCommand = function () {
  return this.command
}

// data could be array, task or request
CommandBase.prototype.settle = function (client, cmd) {
  var mode = cmd.rsp || ''

  switch (mode)
  {
    case RESULT_ACK:  this.resolve(cmd.data); return false;
    case RESULT_OK:   this.resolve(cmd.data); return true;
    case RESULT_ERR:  this.reject (cmd.data); return true;
    case RESULT_EMIT: if (this.callback) this.callback(cmd.data); return false;

    case REQUEST_TASK:
    case REQUEST_EVENT:
      if (this.callback) {
        var task = new Task(client.sendTaskResponse, cmd);
        this.callback(cmd.data, task);
      }
      return false
    default:
      this.reject(cmd.data)
      return true
  }
};

function Login (attr) {
  CommandBase.call(this, { ft: 'LOGIN', attr: attr })
}
inherits(Login, CommandBase);

function Echo () {
  CommandBase.call(this, { ft: 'ECHO' })
}
inherits(Echo, CommandBase)

function Register (uri, callback) {
  var command = {}
  command.ft = 'REG'
  command.uri = wampParse(uri)
  command.opt = {}
  CommandBase.call(this, command)
  this.callback = callback
}
inherits(Register, CommandBase)

function UnRegister (registration) {
  var command = {}
  command.ft = 'UNREG'
  command.unr = registration
  CommandBase.call(this, command)
}
inherits(UnRegister, CommandBase)

function Call (uri, callback) {
  var command = {}
  command.ft = 'CALL'
  command.uri = wampParse(uri)
  this.callback = callback
  CommandBase.call(this, command)
}
inherits(Call, CommandBase)

function Trace(uri, callback, opt) {
  var command = {}
  command.ft = 'TRACE'
  command.uri = wampParse(uri)
  command.opt = opt || {}
  CommandBase.call(this, command)
  this.callback = callback
}
inherits(Trace, CommandBase)

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
  command.uri = wampParse(uri);
  command.ack = true;
  command.opt = opt || {};
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

    that.sender.send(command);
    return commandId;
  };

  function _sendTaskResponse(request, responseMode, data)
  {
    if (!request.qid) // no response needed
      return false;

    var header = {
      qid: request.qid,
      rqt: responseMode,
      data: data
    };
    if (request.rsp === REQUEST_EVENT) {
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
    that.sender.send({ft:'GOODBYE'});
  };

  this.cleanup = function() {
  };
}

ClientBase.prototype.parseData = function (data) {
  let result

  if (data) {
    if (data.hasOwnProperty('kv')) {
      result = data.kv
    }
    else if (data.hasOwnProperty('message')) {
      // exception
      result = data
    }
    else if (data.hasOwnProperty('kwargs')) {
      if (Array.isArray(data.args) && data.args.length > 0) {
        result = data
      }
      else {
        result = data.kwargs
      }
    }
  }
  return result
}

exports.CommandBase = CommandBase
exports.Login = Login
exports.Echo = Echo
exports.Register = Register
exports.UnRegister = UnRegister
exports.Call = Call
exports.Trace = Trace
exports.UnTrace = UnTrace
exports.Push = Push

exports.Task = Task
exports.ClientBase = ClientBase
