'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('../messages')
const { wampCode } = require('./msg')
const { wampParse, restoreUri } = require('../topic_pattern')
const dparse = require('./dparse')
const Session = require('../session')
const Context = require('../context')

class WampApiContext extends Context {
  sendInvoke (cmd) {
    const [args, kwargs] = dparse(cmd.data)
    cmd.id.cb(cmd.qid, args, kwargs, cmd.opt)
  }

  sendResult (cmd) {
    const [args, kwargs] = dparse(cmd.data)
    if (cmd.err) {
      cmd.id.reject({code: wampCode(cmd.err), message: cmd.data.errorText})
    } else if (cmd.rsp === RESULT_EMIT) {
      cmd.id.cb(args, kwargs)
    } else {
      cmd.id.resolve({args, kwargs})
    }
  }

  sendEvent (cmd) {
    const [args, kwargs] = dparse(cmd.data)
    cmd.id.cb(cmd.qid, args, kwargs, cmd.opt)
  }

  acknowledged (cmd) {
    if (cmd.id && cmd.id.resolve) {
      cmd.id.resolve(cmd.qid)
    }
  }

  sendError (cmd, code, text) {
    if (cmd.id && cmd.id.reject) {
      cmd.id.reject({ error: wampCode(code), message: text })
    }
  }
}

function WampApi (realm, sessionId) {
  Session.call(this, this, sessionId)

  const ctx = new WampApiContext(realm.getRouter(), this)

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, cb) {
    return new Promise((resolve, reject) => {
      realm.doRegRpc(ctx, {
        id: {cb, resolve, reject},
        uri: wampParse(uri),
        opt: {}
      })
    })
  }

  this.unregister = function (regId) {
    return restoreUri(
      realm.doUnRegRpc(ctx, {
        unr: regId
      })
    )
  }

  this.callrpc = function (uri, args, kwargs, cb, opt) {
    return new Promise((resolve, reject) => {
      realm.doCallRpc(ctx, {
        id: {cb, resolve, reject},
        uri: wampParse(uri),
        data: { args, kwargs },
        opt: opt || {}
      })
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
    return new Promise((resolve, reject) => {
      realm.doTrace(ctx, {
        id: {cb, resolve, reject},
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
    let result
    let subContainer
    let ack
    if (opt.acknowledge) {
      ack = true
      delete opt.acknowledge
      subContainer = {}
      result = new Promise((resolve, reject) => {
        subContainer.resolve = resolve
        subContainer.reject = reject
      })
    }
    realm.doPush(ctx, {
      id: subContainer,
      uri: wampParse(uri),
      opt,
      data: { args, kwargs },
      ack
    })
    return result
  }

  // gate override/internal part
  this.getGateProtocol = function () {
    return 'internal.wamp.api'
  }
}
inherits(WampApi, Session)

module.exports = WampApi
