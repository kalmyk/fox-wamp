'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('../messages')
const { wampParse, restoreUri } = require('../topic_pattern')
const dparse = require('./dparse')
const Session = require('../session')
const tools = require('../tools')
const Context = require('../context')

class WampApiContext extends Context {
  sendInvoke (cmd) {
    let [args, kwargs] = dparse(cmd.data)
    cmd.id(cmd.qid, args, kwargs, cmd.opt)
  }

  sendResult (cmd) {
    let resOpt = {}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    let [args, kwargs] = dparse(cmd.data)
    cmd.id(cmd.err, args, kwargs, resOpt)
  }

  sendEvent (cmd) {
    let [args, kwargs] = dparse(cmd.data)
    cmd.id.cb(cmd.qid, args, kwargs, cmd.opt)
  }

  acknowledged (cmd) {
    // console.log('ACK message not handled', cmd)
    if (cmd.id && cmd.id.resolve) {
      cmd.id.resolve(cmd.qid)
    }
  }
}

function WampApi (realm) {
  Session.call(this, this)
  this.sessionId = tools.randomId()

  let ctx = new WampApiContext(realm.getRouter(), this)

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, callback) {
    return realm.doRegRpc(ctx, {
      id: callback,
      uri: wampParse(uri),
      opt: {}
    })
  }

  this.unregister = function (regId) {
    return restoreUri(
      realm.doUnRegRpc(ctx, {
        unr: regId
      })
    )
  }

  this.callrpc = function (uri, args, kwargs, callback, opt) {
    return realm.doCallRpc(ctx, {
      id: callback,
      uri: wampParse(uri),
      data: { args, kwargs },
      opt: opt || {}
    })
  }

  this.resrpc = function (qid, err, args, kwargs, opt) {
    return realm.doYield(ctx, {
      qid,
      err,
      data: { args, kwargs },
      opt: opt || {}
    })
  }

  // event (qid, args, kwargs, opt)
  this.subscribe = function (uri, cb, opt) {
    let subContainer = {cb}
    return new Promise((resolve, reject) => {
      subContainer.resolve = resolve
      subContainer.reject = reject
      realm.doTrace(ctx, {
        id: subContainer,
        uri: wampParse(uri),
        opt: opt || {}
      })
    })
  }

  this.unsubscribe = function (topicId) {
    return restoreUri(realm.doUnTrace(ctx, {
      unr: topicId
    }))
  }

  this.publish = function (uri, args, kwargs, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    return realm.doPush(ctx, { uri: wampParse(uri), opt, data: { args, kwargs } })
  }

  // gate override/internal part
  this.getGateProtocol = function () {
    return 'internal.wamp.api'
  }

  this.cleanup = function () {}
}
inherits(WampApi, Session)

module.exports = WampApi
