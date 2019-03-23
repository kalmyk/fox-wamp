'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('../messages')
const dparse = require('./dparse')
const Session = require('../session')
const tools = require('../tools')

function WampApi (realm) {
  this.getEncoder = function () {
    return this
  }

  Session.call(this, this)

  this.sessionId = tools.randomId()

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, callback) {
    return realm.doRegRpc(this, {
      id: callback,
      uri: uri,
      opt: {}
    })
  }

  this.unregister = function (regId) {
    return realm.doUnRegRpc(this, {
      unr: regId
    })
  }

  this.callrpc = function (uri, args, kwargs, callback, opt) {
    return realm.doCallRpc(this, {
      id: callback,
      uri,
      data: { args, kwargs },
      opt: opt || {}
    })
  }

  this.resrpc = function (qid, err, args, kwargs, opt) {
    return realm.doYield(this, {
      qid,
      err,
      data: { args, kwargs },
      opt: opt || {}
    })
  }

  this.subscribe = function (uri, callback, opt) {
    return realm.doTrace(this, {
      id: callback,
      uri,
      opt: opt || {}
    })
  }

  this.unsubscribe = function (topicId) {
    return realm.doUnTrace(this, {
      unr: topicId
    })
  }

  this.publish = function (uri, args, kwargs, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    return realm.doPush(this, { uri, opt, data: { args, kwargs } })
  }

  // gate override/internal part
  this.sendInvoke = function (sender, cmd) {
    let [args, kwargs] = dparse(cmd.data)
    cmd.id(cmd.qid, args, kwargs, cmd.opt)
  }

  this.sendResult = function (sender, cmd) {
    let resOpt = {}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    let [args, kwargs] = dparse(cmd.data)
    cmd.id(cmd.err, args, kwargs, resOpt)
  }

  this.sendEvent = function (sender, cmd) {
    let [args, kwargs] = dparse(cmd.data)
    cmd.id(cmd.qid, args, kwargs, cmd.opt)
  }

  this.acknowledged = function () {
    // console.log('ACK message not handled', cmd)
  }

  this.getGateProtocol = function () {
    return 'internal.wamp.api'
  }
}
inherits(WampApi, Session)

module.exports = WampApi
