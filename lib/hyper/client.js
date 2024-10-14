'use strict'

const { defaultParse, restoreUri } = require('../topic_pattern')
const Context = require('../context')
const { RESULT_OK, RESULT_ACK, RESULT_EMIT, RESULT_ERR,
  REQUEST_TASK, REQUEST_EVENT } = require('../messages')

class HyperApiContext extends Context {
  sendInvoke (cmd) {
    cmd.id.cb(cmd.data, cmd.opt)
  }

  sendResult (cmd) {
    const resOpt = {sid: cmd.sid, id: cmd.qid}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    if (cmd.err) {
      cmd.id.reject({error:{code: cmd.err, message: cmd.data}})
    } else {
      cmd.id.resolve(cmd.data)
    }
  }

  sendEvent (cmd) {
    cmd.id.cb(cmd.data, {sid: cmd.sid, id: cmd.qid})
  }

  sendAck (cmd) {
    if (cmd.id && cmd.id.resolve) {
      cmd.id.resolve(cmd.qid)
    }
  }

  sendError (cmd, code, text) {
    if (cmd.id && cmd.id.reject) {
      cmd.id.reject({ error: code, message: text })
    }
  }
}

function HyperClient (realm, ctx) {
  
  this.echo = function (data) {
    return new Promise((resolve, reject) => {
      realm.cmdEcho(ctx, {
        id: {resolve, reject},
        data: data
      })
    })
  }

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = (uri, cb, opt) => {
    return new Promise((resolve, reject) => {
      realm.cmdRegRpc(ctx, {
        id: {cb, resolve, reject},
        uri: defaultParse(uri),
        opt: opt || {}
      })
    })
  }

  this.unregister = function (regId) {
    return new Promise((resolve, reject) => {
    // todo restoreUri(
      realm.cmdUnRegRpc(ctx, {
        id: {resolve, reject},
        unr: regId
      })
    })
  }

  this.callrpc = function (uri, data, opt) {
    const callOpt = opt || {}
    const progress_cb = callOpt.progress
    delete callOpt.progress
    return new Promise((resolve, reject) => {
      realm.cmdCallRpc(ctx, {
        id: {cb: progress_cb, resolve, reject},
        uri: defaultParse(uri),
        data: data,
        opt: callOpt
      })
    })
  }

  // event (args, headers, opt.publication)
  // resolve traceId
  this.subscribe = function (uri, cb, opt) {
    return new Promise((resolve, reject) => {
      return realm.cmdTrace(ctx, {
        id: {cb, resolve, reject},
        uri: defaultParse(uri),
        opt: opt || {}
      })
    })
  }

  this.unsubscribe = function (subId) {
    return new Promise((resolve, reject) => {
      // todo: restoreUri(
      realm.cmdUnTrace(ctx, {
        id: {resolve, reject},
        unr: subId
      })
    })
  }

  this.publish = function (uri, data, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    let result
    let subContainer
    let ack = false
    if (opt.acknowledge) {
      ack = true
      delete opt.acknowledge
      subContainer = {}
      result = new Promise((resolve, reject) => {
        subContainer.resolve = resolve
        subContainer.reject = reject
      })
    } else {
      result = Promise.resolve()
    }
    // do not wait if no ack in request
    realm.cmdPush(ctx, {
      id: subContainer,
      uri: defaultParse(uri),
      opt,
      data: data,
      ack
    })
    return result
  }
}

// implements realm interface
function HyperSocketFormatter (socket) {
  let commandId = 0
  let cmdList = new Map()

  const sendCommand = (id, command) => {
    command.id = ++commandId
    cmdList.set(commandId, id)

    socket.send(command)
    return commandId
  }

  this.settle = function (action, cmd) {
    let mode = cmd.rsp || ''
  
    switch (mode) {
    case RESULT_ACK:    action.resolve(cmd.data); return false
    case RESULT_OK:     action.resolve(cmd.data); return true
    case RESULT_ERR:    action.reject (cmd.data); return true
    case RESULT_EMIT:   action.cb(cmd.data); return false  
    case REQUEST_EVENT: try {
                action.cb(cmd.data, {topic: restoreUri(cmd.uri)})
              }
              catch (e) {}
              return false
    case REQUEST_TASK:  
              const taskResult = action.cb(cmd.data, {
                procedure: restoreUri(cmd.uri),
                progress: (info, opt) => {
                  socket.send({
                    ft: 'YIELD',
                    qid: cmd.qid,
                    rqt: RESULT_EMIT,
                    data: info,
                    opt: opt
                  })
                }
              })
              Promise.resolve(taskResult).then(result => {
                socket.send({
                  ft: 'YIELD',
                  qid: cmd.qid,
                  rqt: RESULT_OK,
                  data: result
                })
              });
              return false
    default:
      action.reject(cmd.data)
      return true
    }
  }

  this.onMessage = (msg) => {
    if (msg.id && cmdList.has(msg.id)) {
      let action = cmdList.get(msg.id)
      if (this.settle(action, msg)) {
        delete cmdList[msg.id]
      }
    } else {
      // unknown command ID arrived, nothing to do, could write error?
      console.log('UNKNOWN PACKAGE', msg)
    }
  }

  this.cmdEcho = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'ECHO', data: cmd.data})
  }

  this.cmdRegRpc = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'REG', uri: cmd.uri, opt: cmd.opt})
  }

  this.cmdUnRegRpc = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'UNREG', unr: cmd.unr})
  }

  this.cmdCallRpc = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'CALL', uri: cmd.uri, data: cmd.data, opt: cmd.opt})
  }

  this.cmdTrace = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'TRACE', uri: cmd.uri, opt: cmd.opt})
  }

  this.cmdUnTrace = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'UNTRACE', unr: cmd.unr})
  }

  this.cmdPush = function (ctx, cmd) {
    return sendCommand(cmd.id, {ft: 'PUSH', uri: cmd.uri, data: cmd.data, opt: cmd.opt, ack: cmd.ack})
  }
}

exports.HyperClient = HyperClient
exports.HyperApiContext = HyperApiContext
exports.HyperSocketFormatter = HyperSocketFormatter
