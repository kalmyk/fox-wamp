'use strict'

const WAMP = require('./protocol')
const dparse = require('./dparse')
const errorMessages = require('./msg').errorMessages
const { wampParse, restoreUri } = require('../topic_pattern')
const { RESULT_EMIT, RESULT_OK } = require('../messages')
const BaseGate = require('../base_gate')
const RealmError = require('../realm_error').RealmError
const Context = require('../context')

let handlers = {}
let cmdAck = {}

class WampContext extends Context {
  sendInvoke (cmd) {
    let invOpts = {}
    if (cmd.opt.receive_progress) {
      invOpts.receive_progress = true
    }
    let [args, kwargs] = dparse(cmd.data)
    this.wampSend([
      WAMP.INVOCATION,
      cmd.qid,
      cmd.subId,
      invOpts,
      args,
      kwargs
    ])
  }

  sendResult (cmd) {
    if (cmd.err) {
      this.wampSendError(WAMP.CALL, cmd.id, 'wamp.error.callee_failure', cmd.data.args)
      return
    }
    let resOpt = {}
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true
    }
    let [args, kwargs] = dparse(cmd.data)
    this.wampSend([
      WAMP.RESULT,
      cmd.id,
      resOpt,
      args,
      kwargs
    ])
  }

  sendEvent (cmd) {
    let eventOpt = {
      topic: restoreUri(cmd.uri)
    }
    if (cmd.opt.retained) {
      eventOpt.retained = true
    }
    let [args, kwargs] = dparse(cmd.data)
    this.wampSend([
      WAMP.EVENT,
      cmd.traceId,
      cmd.qid,
      eventOpt,
      args,
      kwargs
    ])
  }

  acknowledged (cmd) {
    cmdAck[cmd.wtype].call(this, cmd)
  }

  sendError (cmd, errorCode, text) {
    return this.wampSendError(cmd.wtype, cmd.id, errorCode, text)
  }

  wampSendError (mtype, requestId, errorCode, text) {
    if (requestId) { // do not send on disconnect
      let wampCode
      if (errorMessages[errorCode]) {
        wampCode = errorMessages[errorCode]
      } else {
        wampCode = errorCode
      }

      var msg = [WAMP.ERROR, mtype, requestId, {}, wampCode]
      if (text) {
        msg.push([text])
      }

      this.wampSend(msg)
    }
  }

  wampSend (msg, callback) {
    this.sender.send(msg, callback)
  }

  wampClose (code, reason) {
    this.sender.close(code, reason)
  }
}

class WampGate extends BaseGate {
  createContext (session, sender) {
    return new WampContext(this._router, session, sender)
  }

  hello (ctx, session, realmName, details) {
    session.realmName = realmName
    session.secureDetails = details
    if (!this.isAuthRequired(session)) {
      this.getRouter().getRealm(realmName, function (realm) {
        session.setAuthMethod('anonymous')
        realm.joinSession(session)
        let welcomeInfo = this.makeRealmDetails(session.realmName)
        welcomeInfo.authmethod = session.getAuthMethod()
        this.sendWelcome(ctx, session.sessionId, welcomeInfo)
      }.bind(this))
      return
    }

    let methods = details.hasOwnProperty('authmethods') && Array.isArray(details.authmethods) ? details.authmethods : []
    let authMethod = this.getAcceptedAuthMethod(methods)
    if (authMethod) {
      session.setAuthMethod(authMethod)
      let extra = {}
      if (typeof this._authHandler[authMethod + '_extra'] === 'function') {
        this._authHandler[authMethod + '_extra'](session.realmName, session.secureDetails, (err, extra) => {
          if (err) {
            this.sendAbort(ctx, 'wamp.error.no_auth_method')
          }
          else {
            this.sendChallenge(ctx, authMethod, extra)
          }
        })
        return
      }
      this.sendChallenge(ctx, authMethod, extra)
    }
    else {
      this.sendAbort(ctx, 'wamp.error.no_auth_method')
    }
  }

  authenticate (ctx, session, secret, extra) {
    let authMethod = session.getAuthMethod()
    this._authHandler[authMethod + '_auth'](session.realmName, session.secureDetails, secret, extra, function (err, userDetails) {
      if (err) {
        this.sendAbort(ctx, 'wamp.error.authentication_failed')
      } else {
        session.setUserDetails(userDetails)
        this.getRouter().getRealm(session.realmName, function (realm) {
          realm.joinSession(session)
          let welcomeInfo = this.makeRealmDetails(session.realmName)
          welcomeInfo.authid = session.secureDetails.authid
          welcomeInfo.authmethod = session.authmethod
          this.sendWelcome(ctx, session.sessionId, welcomeInfo)
        }.bind(this))
      }
    }.bind(this))
  }

  makeRealmDetails (realmName) {
    return {
      realm: realmName,
      roles: {
        broker: {
          features: {
            session_meta_api: true,
            publisher_exclusion: true
          }
        },
        dealer: {
          features: {
            session_meta_api: true,
            progressive_call_results: true
          }
        }
      }
    }
  }

  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized')
    }
  }

  sendWelcome (ctx, sessionId, details) {
    ctx.wampSend([WAMP.WELCOME, sessionId, details])
  }

  sendChallenge (ctx, authmethod, extra) {
/*
    https://github.com/vrana/WAMP/blob/master/spec/advanced.md#wamp-challenge-response-authentication
[
    4,
    "wampcra",
    {
        "challenge": "{
            \"nonce\": \"LHRTC9zeOIrt_9U3\",
            \"authprovider\": \"userdb\",
            \"authid\": \"peter\",
            \"timestamp\": \"2014-06-22T16:36:25.448Z\",
            \"authrole\": \"user\",
            \"authmethod\": \"wampcra\",
            \"session\": 3251278072152162}"
        }
]
*/
    ctx.wampSend([WAMP.CHALLENGE, authmethod, extra])
  }

  sendGoodbye (ctx) {
    // Graceful termination
    var msg = [WAMP.GOODBYE, {}, 'wamp.error.goodbye_and_out']
    ctx.wampSend(msg, function () {
      ctx.wampClose(1000, 'Server closed WAMP session')
    })
  }

  sendAbort (ctx, reason) { // auth failed
    var msg = [WAMP.ABORT, {}, reason]
    ctx.wampSend(msg, function () {
      ctx.wampClose(1000, 'Server closed WAMP session')
    })
  }

  handle (ctx, session, msg) {
    if (!Array.isArray(msg)) {
      ctx.wampClose(1003, 'protocol violation')
      return
    }
    var mtype = msg.shift()
    if (!handlers[mtype]) {
      ctx.wampClose(1003, 'protocol violation')
      return
    }
    try {
      handlers[mtype].call(this, ctx, session, msg)
    } catch (err) {
      if (err instanceof RealmError) {
        ctx.wampSendError(mtype, err.requestId, err.code, err.message)
      } else {
        throw err
      }
    }
  }

  getProtocol () {
    return 'wamp.2.json'
  }
}

handlers[WAMP.HELLO] = function (ctx, session, message) {
  const realmName = message.shift()
  const details = message.shift()
  if (session.realm === null) {
    this.hello(ctx, session, realmName, details)
  } else {
    ctx.wampClose(1002, 'protocol violation')
  }
  return false
}

handlers[WAMP.AUTHENTICATE] = function (ctx, session, message) {
  const secret = message.shift()
  const extra = message.shift()
  if (session.realm === null) {
    this.authenticate(ctx, session, secret, extra)
  } else {
    ctx.wampClose(1002, 'protocol violation')
  }
}

handlers[WAMP.GOODBYE] = function (ctx, session, message) {
  this.sendGoodbye(ctx)
}

handlers[WAMP.REGISTER] = function (ctx, session, message) {
  let id = message.shift()
  let inopt = message.shift()
  let uri = wampParse(message.shift())

  this.checkRealm(session, id)
//  this.checkAuthorize(ctx, cmd, 'register')

  let opt = {}
  if (Number.isInteger(inopt.concurrency)) {
    opt.simultaneousTaskLimit = inopt.concurrency
  } else {
    // set simultaneous tasks unlimited
    opt.simultaneousTaskLimit = -1
  }

  if (inopt.reducer) {
    opt.reducer = true
  }

  // https://autobahn.readthedocs.io/en/latest/reference/autobahn.wamp.html#autobahn.wamp.types.RegisterOptions
  // option.concurrency – if used, the number of times a particular endpoint may be called concurrently
  session.realm.doRegRpc(ctx, { wtype: WAMP.REGISTER, id, uri, opt })
}

cmdAck[WAMP.REGISTER] = function (cmd) {
  this.wampSend([WAMP.REGISTERED, cmd.id, cmd.qid])
}

handlers[WAMP.CALL] = function (ctx, session, message) {
  var id = message.shift()
  var opt = message.shift() || {}
  var uri = wampParse(message.shift())
  var args = message.shift() || []
  var kwargs = message.shift() || null

  this.checkRealm(session, id)
  // this.checkAuthorize(ctx, cmd, 'call')
  let cmd = {
    id,
    uri,
    opt: {},
    data: (kwargs === null && args instanceof Array && args.length === 0
      ? null
      : { args, kwargs }
    )
  }

  if (opt.receive_progress) {
    cmd.opt.receive_progress = true
  }
  session.realm.doCallRpc(ctx, cmd)
}

handlers[WAMP.CANCEL] = function (ctx, session, message) {
  var id = message.shift()
  var opt = message.shift() || {}
  session.realm.doCancel(ctx, { wtype: WAMP.CANCEL, id, opt })
}

handlers[WAMP.UNREGISTER] = function (ctx, session, message) {
  var id = message.shift()
  var unr = message.shift()

  this.checkRealm(session, id)
  session.realm.doUnRegRpc(ctx, { wtype: WAMP.UNREGISTER, id, unr })
}

cmdAck[WAMP.UNREGISTER] = function (cmd) {
  if (cmd.id) { // do not send on disconnect
    this.wampSend([WAMP.UNREGISTERED, cmd.id])
  }
}

handlers[WAMP.YIELD] = function (ctx, session, message) {
  var qid = message.shift()
  var opt = message.shift()
  var args = message.shift() || []
  var kwargs = message.shift()
  this.checkRealm(session, qid)

  let cmd = { qid, data: { args, kwargs }, opt }
  if (opt && opt.progress) {
    cmd.rqt = RESULT_EMIT
    delete opt.progress
  } else {
    cmd.rqt = RESULT_OK
  }

  session.realm.doYield(ctx, cmd)
}

handlers[WAMP.SUBSCRIBE] = function (ctx, session, message) {
  const id = message.shift()
  const opt = message.shift()
  const uri = wampParse(message.shift())

  this.checkRealm(session, id)
  const cmd = {
    wtype: WAMP.SUBSCRIBE,
    id,
    uri,
    opt
  }
  if (this.checkAuthorize(ctx, cmd, 'subscribe')) {
    session.realm.doTrace(ctx, cmd)
  }
}

cmdAck[WAMP.SUBSCRIBE] = function (cmd) {
  this.wampSend([WAMP.SUBSCRIBED, cmd.id, cmd.qid])
}

handlers[WAMP.UNSUBSCRIBE] = function (ctx, session, message) {
  const id = message.shift()
  const unr = message.shift()

  this.checkRealm(session, id)
  session.realm.doUnTrace(ctx, { wtype: WAMP.UNSUBSCRIBE, id, unr })
}

cmdAck[WAMP.UNSUBSCRIBE] = function (cmd) {
  if (cmd.id) { // do not send on disconnect
    this.wampSend([WAMP.UNSUBSCRIBED, cmd.id])
  }
}

handlers[WAMP.PUBLISH] = function (ctx, session, message) {
  const id = message.shift()
  const opt = message.shift() || {}
  const uri = wampParse(message.shift())
  const args = message.shift() || []
  const kwargs = message.shift() || null

  const cmd = {
    wtype: WAMP.PUBLISH,
    id,
    uri,
    data: (kwargs === null && args instanceof Array && args.length === 0
      ? null
      : { args, kwargs }
    )
  }

  if (opt.acknowledge) {
    cmd.ack = true
  }
  delete opt.acknowledge

  if (opt.exclude_me !== false) {
    opt.exclude_me = true
  }

  cmd.opt = opt

  this.checkRealm(session, id)
  if (this.checkAuthorize(ctx, cmd, 'publish')) {
    session.realm.doPush(ctx, cmd)
  }
}

cmdAck[WAMP.PUBLISH] = function (cmd) {
  this.wampSend([WAMP.PUBLISHED, cmd.id, cmd.qid])
}

handlers[WAMP.ERROR] = function (ctx, session, message) {
  let requestType = message.shift()
  let qid = message.shift()
  let details = message.shift()
  let errorUri = message.shift() // not used!
  let args = message.shift() || []
  let kwargs = message.shift()

  // when invocation failed
  this.checkRealm(session, qid)
  if (requestType === WAMP.INVOCATION) {
    session.realm.doYield(ctx, {
      qid,
      err: new Error(details),
      data: { args, kwargs }
    })
  }

  return false
}

module.exports = WampGate
