'use strict'

const { SESSION_TX, SESSION_RX, RESULT_OK, RESULT_ACK, RESULT_ERR,
  REQUEST_EVENT, REQUEST_TASK } = require('../messages')
const { BaseGate } = require('../base_gate')
const { errorCodes, RealmError } = require('../realm_error')
const Context = require('../context')

function parseHyperBody(kv) {
  return kv === null ? null : {kv:kv}
}

let handlers = {}

// requires socketWriter with
// ::send(msg, callback)
// ::close(code, reason)

class FoxSocketWriterContext extends Context {
  constructor (router, session, socketWriter) {
    super(router, session)
    this.socketWriter = socketWriter
  }

  sendRegistered (cmd) {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_ACK,
      qid: cmd.qid
    })
  }
  
  sendUnregistered (cmd) {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_OK
    })
  }
  
  sendInvoke (cmd) {
    this.foxSend({
      id: cmd.id,
      uri: cmd.uri,
      qid: cmd.qid,
      opt: cmd.opt,
      rsp: REQUEST_TASK,
      data: cmd.data
    })
  }

  sendResult (cmd) {
    this.foxSend({
      id: cmd.id,
      rsp: cmd.rsp,
      data: cmd.data
    })
  }

  sendEvent (cmd) {
    this.foxSend({
      id: cmd.id,
      uri: cmd.uri,
      qid: cmd.qid,
      opt: cmd.opt,
      hdr: cmd.hdr,
      sid: cmd.sid,
      rsp: REQUEST_EVENT,
      data: cmd.data
    })
  }

  sendOkey (cmd) {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_OK,
      data: cmd.data
    })
  }
  
  sendSubscribed (cmd) {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_ACK,
      qid: cmd.qid
    })
  }

  sendEndSubscribe (cmd) {
    this.foxSend({id: cmd.id, rsp: RESULT_OK, qid: cmd.qid})
  }

  sendUnsubscribed (cmd) {
    this.foxSend({id: cmd.id, rsp: RESULT_OK})
  }

  sendPublished (cmd) {
    this.foxSend({id: cmd.id, rsp: RESULT_OK, qid: cmd.qid})
  }

  foxSend (msg, callback) {
    this.router.emit(SESSION_TX, this.session, JSON.stringify(msg))
    this.socketWriter.hyperPkgWrite(msg, callback)
  }

  foxClose (code, reason) {
    this.socketWriter.hyperPkgClose(code, reason)
  }

  foxSendError (requestId, errCode, errMessage) {
    this.foxSend({
      id: requestId,
      rsp: RESULT_ERR,
      data: { code: errCode, message: errMessage }
    })
  }
}

class FoxGate extends BaseGate {
  createContext (session, socketWriter) {
    return new FoxSocketWriterContext(this.getRouter(), session, socketWriter)
  }

  checkHeader (index) {
    if (this.msg.hasOwnProperty(index)) {
      return true
    }

    this.sendError(
      errorCodes.ERROR_HEADER_IS_NOT_COMPLETED,
      'Header is not completed "' + index + '"'
    )
    return false
  }

  checkRealm (session, requestId) {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized')
    }
  }

  sendWelcome (ctx, session, cmd) {
    ctx.foxSend({
      id: cmd.id,
      rsp: RESULT_OK,
      data: {
        kv: {
          routerInfo: this.getRouter().getRouterInfo(),
          realmInfo: session.getRealmInfo()
        }
      }
    })
  }

  handle (ctx, session, msg) {
    this._router.emit(SESSION_RX, session, JSON.stringify(msg))
    if (typeof msg !== 'object') {
      ctx.foxClose(1003, 'protocol violation')
      return
    }
    let foxType = msg.ft
    if (!handlers[foxType]) {
      console.log('Type Not Found', msg)
      ctx.foxClose(1003, 'protocol violation')
      return
    }
    try {
      handlers[foxType].call(this, ctx, session, msg)
    } catch (err) {
      if (err instanceof RealmError) {
        ctx.foxSendError(err.requestId, err.code, err.message)
      } else {
        console.log('hyper-gate-error', foxType, err)
        throw err
      }
    }
  }
}

handlers.LOGIN = function (ctx, session, message) {
  this.getRouter().getRealm(message.data.realm, function (realm) {
    realm.joinSession(session)
    ctx.foxSend({
      id: message.id,
      rsp: RESULT_OK
      // data: undefined
    })
  })
}

handlers.ECHO = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdEcho(ctx, message)
}

handlers.YIELD = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdYield(ctx, message)
}

handlers.CONFIRM = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdConfirm(ctx, message)
}

handlers.REG = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdRegRpc(ctx, message)
}

handlers.UNREG = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdUnRegRpc(ctx, message)
}

handlers.CALL = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdCallRpc(ctx, message)
}

handlers.TRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdTrace(ctx, message)
}

handlers.UNTRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdUnTrace(ctx, message)
}

handlers.PUSH = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.cmdPush(ctx, message)
}

handlers.GOODBYE = function (ctx, session, message) {
  ctx.foxClose(1000, 'Server closed session')
}

exports.FoxGate = FoxGate
exports.parseHyperBody = parseHyperBody
