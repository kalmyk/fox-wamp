'use strict'

const inherits = require('util').inherits
const { RESULT_EMIT } = require('../messages')
const { wampErrorCode } = require('./msg')
const { errorCodes } = require('../realm_error')
const { wampUriParse, restoreUri } = require('../topic_pattern')
const Session = require('../session')
const Context = require('../context')
const { parseWampArgs, toWampArgs, buildInvokeOpt, buildEventOpt } = require('./gate')

class WampApiContext extends Context {
  sendInvoke (cmd) {
    cmd.id.cb(cmd.qid, toWampArgs(cmd.data), cmd.hdr, buildInvokeOpt(cmd))
  }

  sendResult (cmd) {
    if (cmd.err) {
      cmd.id.reject({code: wampErrorCode(cmd.err), message: cmd.data})
    } else {
      const args = toWampArgs(cmd.data)
      const kwargs = cmd.hdr
      if (cmd.rsp === RESULT_EMIT) {
        cmd.id.cb(args, kwargs)
      } else {
        cmd.id.resolve({args, kwargs})
      }
    }
  }

  sendEvent (cmd) {
    cmd.id.cb(cmd.qid, toWampArgs(cmd.data), cmd.hdr, buildEventOpt(cmd))
  }

  sendRegistered (cmd) {
    cmd.id.resolve(cmd.qid)
  }

  sendUnregistered (cmd) {}

  sendSubscribed (cmd) {
    cmd.id.resolve(cmd.qid)
  }

  sendUnsubscribed (cmd) {}

  sendEndSubscribe (cmd) {}

  sendPublished (cmd) {
    cmd.id.resolve(cmd.qid)
  }

  sendError (cmd, code, text) {
    if (cmd.id && cmd.id.reject) {
      cmd.id.reject({ error: wampErrorCode(code), message: text })
    }
  }
}

function WampApi (realm, sessionId) {
  Session.call(this, sessionId)

  const ctx = new WampApiContext(realm.getRouter(), this)

  // API functions
  // register callback = function(id, args, kwargs, opt)
  this.register = function (uri, cb) {
    return new Promise((resolve, reject) => {
      realm.cmdRegRpc(ctx, {
        id: {cb, resolve, reject},
        uri: wampUriParse(uri),
        opt: {}
      })
    })
  }

  this.unregister = function (regId) {
    return restoreUri(
      realm.cmdUnRegRpc(ctx, {
        unr: regId
      })
    )
  }

  this.callrpc = function (uri, args, kwargs, cb, opt) {
    return new Promise((resolve, reject) => {
      realm.cmdCallRpc(ctx, {
        id: {cb, resolve, reject},
        uri: wampUriParse(uri),
        hdr: kwargs,
        data: parseWampArgs(args, kwargs),
        opt: opt || {}
      })
    })
  }

  this.resrpc = function (qid, err, args, kwargs, opt) {
    if (err) {
      return realm.cmdYield(ctx, {
        qid,
        err: errorCodes.ERROR_CALLEE_FAILURE,
        hdr: kwargs,
        data: err,
        opt: opt || {}
      })
    }
    return realm.cmdYield(ctx, {
      qid,
      err,
      hdr: kwargs,
      data: parseWampArgs(args),
      opt: opt || {}
    })
  }

  // event (args, headers, opt.publication)
  // resolve traceId
  this.subscribe = function (uri, cb, opt) {
    return new Promise((resolve, reject) => {
      return realm.cmdTrace(ctx, {
        id: {cb, resolve, reject},
        uri: wampUriParse(uri),
        opt: opt || {}
      })
    })
  }

  this.unsubscribe = function (topicId) {
    return restoreUri(realm.cmdUnTrace(ctx, {
      unr: topicId
    }))
  }

  this.publish = function (uri, args, kwargs, opt) {
    opt = opt || {}
    if (opt.exclude_me !== false) {
      opt.exclude_me = true
    }
    if ('will' in opt) {
      opt.will = parseWampArgs(opt.will)
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
    } else {
      result = Promise.resolve()
    }
    // do not wait if no ack in request
    realm.cmdPush(ctx, {
      id: subContainer,
      uri: wampUriParse(uri),
      opt,
      hdr: kwargs,
      data: parseWampArgs(args),
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
