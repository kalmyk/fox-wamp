'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('./messages')
const Session = require('./session')
const Context = require('./context')

class FoxApiContext extends Context {
  sendInvoke (cmd) {
    cmd.id(cmd.qid, cmd.data, cmd.opt)
  }

  sendResult (cmd) {
    const resOpt = {sid: cmd.sid, id: cmd.qid}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    cmd.id(cmd.err, cmd.data, resOpt)
  }

  sendEvent (cmd) {
    cmd.id(cmd.data, {sid: cmd.sid, id: cmd.qid})
  }

  sendAck () {
    // console.log('ACK message not handled', cmd)
  }
}

function FoxApi (realm, sessionId) {
  Session.call(this, this, sessionId)

  let ctx = new FoxApiContext(realm.getRouter(), this)

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, callback) {
    return realm.cmdRegRpc(ctx, {
      id: callback,
      uri: uri,
      opt: {}
    })
  }

  this.unregister = function (regId) {
    return realm.cmdUnRegRpc(ctx, {
      unr: regId
    })
  }

  this.callrpc = function (uri, kv, callback, opt) {
    return realm.cmdCallRpc(ctx, {
      id: callback,
      uri,
      data: kv,
      opt: opt || {}
    })
  }

  this.resrpc = function (qid, err, kv, opt) {
    return realm.cmdYield(ctx, {
      qid,
      err,
      data: kv,
      opt: opt || {}
    })
  }

  this.subscribe = function (uri, callback, opt) {
    return realm.cmdTrace(ctx, {
      id: callback,
      uri,
      opt: opt || {}
    })
  }

  this.unsubscribe = function (topicId) {
    return realm.cmdUnTrace(ctx, {
      unr: topicId
    })
  }

  this.publish = function (uri, kv, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    realm.cmdPush(ctx, { uri, opt, data: kv })
  }

  // gate override/internal part
  this.getGateProtocol = function () {
    return 'internal.fox.api'
  }
}
inherits(FoxApi, Session)

module.exports = FoxApi
