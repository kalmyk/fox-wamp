'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('./messages')
const Session = require('./session')
const tools = require('./tools')

function FoxApi (realm) {
  Session.call(this)

  this.gate = this
  this.sessionId = tools.randomId()

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, callback) {
    return realm.doRegRpc(this, {
      id: callback,
      uri: uri
    })
  }

  this.unregister = function (regId) {
    return realm.doUnRegRpc(this, {
      unr: regId
    })
  }

  this.callrpc = function (uri, kv, callback, opt) {
    return realm.doCallRpc(this, {
      id: callback,
      uri,
      data: kv,
      opt: opt || {}
    })
  }

  this.resrpc = function (qid, err, kv, opt) {
    return realm.doYield(this, {
      qid,
      err,
      data: kv,
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

  this.publish = function (uri, kv, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    return realm.doPush(this, { uri, opt, data: kv })
  }

  // gate override/internal part
  this.sendInvoke = function (sender, cmd) {
    cmd.id(cmd.qid, cmd.data, cmd.opt)
  }

  this.sendResult = function (sender, cmd) {
    let resOpt = {}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    cmd.id(cmd.err, cmd.data, resOpt)
  }

  this.sendEvent = function (sender, cmd) {
    cmd.id(cmd.qid, cmd.data, cmd.opt)
  }

  this.acknowledged = function () {
    // console.log('ACK message not handled', cmd)
  }

  this.getGateProtocol = function () {
    return 'internal.fox.api'
  }
}
inherits(FoxApi, Session)

module.exports = FoxApi
