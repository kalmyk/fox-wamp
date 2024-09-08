'use strict'

const { RESULT_OK, RESULT_ACK, RESULT_ERR,
  REQUEST_EVENT, REQUEST_TASK } = require('../messages')
const BaseGate = require('../base_gate')
const { errorCodes, RealmError } = require('../realm_error')
const Context = require('../context')

let handlers = {}
let cmdAck = {}

class FoxContext extends Context {
  setFoxType (foxType) {
    this.foxType = foxType
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
      rsp: REQUEST_EVENT,
      data: cmd.data
    })
  }

  sendAck (cmd) {
    cmdAck[this.foxType].call(this, cmd)
  }

  foxSend (msg, callback) {
    this.sender.send(msg, callback)
  }

  foxClose (code, reason) {
    this.sender.close(code, reason)
  }

  foxSendError (requestId, errCode, errMessage) {
    this.foxSend({
      id: requestId,
      ft: this.foxType,
      rsp: RESULT_ERR,
      data: { code: errCode, message: errMessage }
    })
  }
}

class FoxGate extends BaseGate {
  createContext (session, sender) {
    return new FoxContext(this._router, session, sender)
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
      ctx.setFoxType(foxType)
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
  getProtocol () {
    return 'hyper.json'
  }
}

handlers.LOGIN = function (ctx, session, message) {
  this.loginRealm(ctx, session, message)
}

handlers.ECHO = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doEcho(ctx, message)
}

cmdAck.ECHO = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_OK,
    data: cmd.data
  })
}

handlers.YIELD = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doYield(ctx, message)
}

handlers.CONFIRM = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doConfirm(ctx, message)
}

cmdAck.CONFIRM = function (cmd) {
  this.foxSend({
    id: cmd.id,
    qid: cmd.qid,
    rsp: RESULT_OK,
    data: cmd.data
  })
}

handlers.REG = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doRegRpc(ctx, message)
}

cmdAck.REG = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_ACK,
    data: cmd.qid // will unregister
  })
}

handlers.UNREG = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doUnRegRpc(ctx, message)
}

cmdAck.UNREG = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_OK
  })
}

handlers.CALL = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doCallRpc(ctx, message)
}

handlers.TRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doTrace(ctx, message)
}

cmdAck.TRACE = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_ACK,
    data: cmd.qid // will unregister
  })
}

handlers.UNTRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doUnTrace(ctx, message)
}

cmdAck.UNTRACE = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_OK
  })
}

handlers.PUSH = function (ctx, session, message) {
  this.checkRealm(session, message.id)
  session.realm.doPush(ctx, message)
}

cmdAck.PUSH = function (cmd) {
  this.foxSend({
    id: cmd.id,
    rsp: RESULT_OK,
    data: cmd.data
  })
}

handlers.GOODBYE = function (ctx, session, message) {
  ctx.foxClose(1000, 'Server closed session')
}

module.exports = FoxGate
