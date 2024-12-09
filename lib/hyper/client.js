'use strict'

const util = require('util')
const { defaultParse, restoreUri } = require('../topic_pattern')
const Context = require('../context')
const { RESULT_OK, RESULT_ACK, RESULT_EMIT, RESULT_ERR,
  REQUEST_TASK, REQUEST_EVENT } = require('../messages')
const { errorCodes } = require('../realm_error')
const { getBodyValue } = require('../base_gate')
const { parseHyperBody } = require('./gate')

function localAck(action, cmd) {
  action.resolve(cmd.qid)
}

function localOkey(action, cmd) {
  action.resolve(getBodyValue(cmd.data))
}

function localError(action, cmd) {
  action.reject(cmd.data)
}

function localEvent(action, cmd) {
  let eventOpt = {
    publication: cmd.qid,
    topic: restoreUri(cmd.uri),
    headers: cmd.hdr
  }
  action.cb(getBodyValue(cmd.data), eventOpt)
}

function localEmit(action, cmd) {
  action.cb(getBodyValue(cmd.data))
}

function localInvoke(ctx, realm, action, cmd) {
  const callOpt = Object.assign(
    {
      procedure: restoreUri(cmd.uri),
      progress: (progressBody, opt) => {
        realm.cmdYield(ctx, {
          qid: cmd.qid,
          rqt: RESULT_EMIT,
          data: parseHyperBody(progressBody),
          opt: opt
        })
      },
      headers: cmd.hdr
    },
    cmd.opt
  )
  try {
    const taskResult = action.cb(getBodyValue(cmd.data), callOpt)
    Promise.resolve(taskResult).then(result => {
      realm.cmdYield(ctx, {
        rqt: RESULT_OK,
        qid: cmd.qid,
        data: parseHyperBody(result)
      })
    })
  } catch (e) {
    realm.cmdYield(ctx, {
      rqt: RESULT_ERR,
      qid: cmd.qid,
      err: errorCodes.ERROR_CALLEE_FAILURE,
      data: e.message
    })
  }
}

class HyperApiContext extends Context {
  constructor (router, session, realm) {
    super(router, session)
    this._realm = realm
  }

  sendInvoke (cmd) {
    localInvoke(this, this._realm, cmd.id, cmd)
  }

  sendResult (cmd) {
    if (cmd.rsp === RESULT_EMIT) {
      localEmit(cmd.id, cmd)
    } else {
      localOkey(cmd.id, cmd)
    }
  }

  sendEvent (cmd) {
    localEvent(cmd.id, cmd)
  }

  sendOkey (cmd) {
    localOkey(cmd.id, cmd)
  }

  sendRegistered (cmd) {
    localAck(cmd.id, cmd)
  }

  sendUnregistered (cmd) {
    localOkey(cmd.id, cmd)
  }

  sendSubscribed (cmd) {
    localAck(cmd.id, cmd)
  }

  sendUnsubscribed (cmd) {
    localOkey(cmd.id, cmd)
  }

  sendEndSubscribe (cmd) {
    localOkey(cmd.id, cmd)
  }

  sendPublished (cmd) {
    localAck(cmd.id, cmd)
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
        data: parseHyperBody(data)
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
        data: parseHyperBody(data),
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
    if ('acknowledge' in opt) {
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
    let headers
    if ('headers' in opt) {
      headers = opt.headers
      delete opt.headers
    } else {
      headers = {}
    }
    // do not wait if no ack in request
    realm.cmdPush(ctx, {
      id: subContainer,
      uri: defaultParse(uri),
      opt,
      data: parseHyperBody(data),
      hdr: headers,
      ack
    })
    return result
  }
}

// implements realm interface
function HyperSocketFormatter (socketWriter) {
  let commandId = 0
  let cmdList = new Map()

  this.sendCommand = (id, command) => {
    command.id = ++commandId
    cmdList.set(commandId, id)

    socketWriter.hyperPkgWrite(command)
    return commandId
  }

  this.cmdEcho = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'ECHO', data: cmd.data})
  }

  this.cmdRegRpc = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'REG', uri: cmd.uri, opt: cmd.opt})
  }

  this.cmdUnRegRpc = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'UNREG', unr: cmd.unr})
  }

  this.cmdCallRpc = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'CALL', uri: cmd.uri, data: cmd.data, opt: cmd.opt})
  }

  this.cmdTrace = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'TRACE', uri: cmd.uri, opt: cmd.opt})
  }

  this.cmdUnTrace = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'UNTRACE', unr: cmd.unr})
  }

  this.cmdPush = function (ctx, cmd) {
    return this.sendCommand(cmd.id, {ft: 'PUSH', uri: cmd.uri, data: cmd.data, opt: cmd.opt, ack: cmd.ack})
  }

  this.cmdYield = function (ctx, cmd) {
    socketWriter.hyperPkgWrite(Object.assign({ft: 'YIELD'}, cmd))
  }

  const settle = (action, cmd) => {
    let mode = cmd.rsp || ''
  
    switch (mode) {
    case RESULT_ACK:    localAck(action, cmd); return false
    case RESULT_OK:     localOkey(action, cmd); return true
    case RESULT_ERR:    localError(action, cmd); return true
    case RESULT_EMIT:   localEmit(action, cmd); return false  
    case REQUEST_EVENT: localEvent(action, cmd); return false
    case REQUEST_TASK:  localInvoke(this, this, action, cmd); return false
    default:
      action.reject(cmd.data)
      return true
    }
  }

  this.onMessage = (msg) => {
    if (msg.id && cmdList.has(msg.id)) {
      let action = cmdList.get(msg.id)
      if (settle(action, msg)) {
        delete cmdList[msg.id]
      }
    } else {
      // unknown command ID arrived, nothing to do, could write error?
      console.log('UNKNOWN PACKAGE', msg)
    }
  }
}

function RemoteHyperClient (formater) {
  HyperClient.call(this, formater, formater)

  const cmdLogin = function (cmd) {
    return formater.sendCommand(cmd.id, {ft: 'LOGIN', data: cmd.data})
  }

  this.login = function (data) {
    return new Promise((resolve, reject) => {
      cmdLogin({
        id: {resolve, reject},
        data: parseHyperBody(data)
      })
    })
  }
}
util.inherits(RemoteHyperClient, HyperClient)

exports.HyperClient = HyperClient
exports.HyperApiContext = HyperApiContext
exports.HyperSocketFormatter = HyperSocketFormatter
exports.RemoteHyperClient = RemoteHyperClient
