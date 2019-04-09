'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('../messages')
const { wampParse, restoreUri } = require('../topic_pattern')
const dparse = require('./dparse')
const Session = require('../session')
const tools = require('../tools')

function WampApi (realm) {
  this.registerSession = () => {}
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

  // event (qid, args, kwargs, opt)
  this.subscribe = function (uri, cb, opt) {
    let subContainer = {cb}
    return new Promise((resolve, reject) => {
      subContainer.resolve = resolve
      subContainer.reject = reject
      realm.doTrace(this, {
        id: subContainer,
        uri: wampParse(uri),
        opt: opt || {}
      })
    })
  }

  this.unsubscribe = function (topicId) {
    return restoreUri(realm.doUnTrace(this, {
      unr: topicId
    }))
  }

  this.publish = function (uri, args, kwargs, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    return realm.doPush(this, { uri: wampParse(uri), opt, data: { args, kwargs } })
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
    cmd.id.cb(cmd.qid, args, kwargs, cmd.opt)
  }

  this.acknowledged = function (cmd) {
    // console.log('ACK message not handled', cmd)
    if (cmd.id && cmd.id.resolve) {
      cmd.id.resolve(cmd.qid)
    }
  }

  this.getGateProtocol = function () {
    return 'internal.wamp.api'
  }

  this.cleanup = function () {}
}
inherits(WampApi, Session)

module.exports = WampApi
