import { SESSION_TX, SESSION_RX, RESULT_OK, RESULT_ACK, RESULT_ERR,
  REQUEST_EVENT, REQUEST_TASK } from '../messages'
import { BaseGate } from '../base_gate'
import { errorCodes, RealmError } from '../realm_error'
import { Context } from '../context'
import { Router } from '../router'
import { Session } from '../session'
import { RealmCommand } from '../types'

export function parseHyperBody(kv: any): any {
  return kv === null ? null : { kv: kv }
}

type Handler = (this: FoxGate, ctx: FoxSocketWriterContext, session: Session, message: any) => void;

const handlers: { [key: string]: Handler } = {};

export class FoxSocketWriterContext extends Context {
  socketWriter: any;

  constructor(router: Router, session: Session, socketWriter: any) {
    super(router, session);
    this.socketWriter = socketWriter;
  }

  sendRegistered(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_ACK,
      qid: cmd.qid
    });
  }

  sendUnregistered(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_OK
    });
  }

  sendInvoke(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      uri: cmd.uri,
      qid: cmd.qid,
      opt: cmd.opt,
      rsp: REQUEST_TASK,
      data: cmd.data
    });
  }

  sendResult(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      rsp: cmd.rsp,
      data: cmd.data
    });
  }

  sendEvent(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      uri: cmd.uri,
      qid: cmd.qid,
      opt: cmd.opt,
      hdr: cmd.hdr,
      sid: cmd.sid,
      rsp: REQUEST_EVENT,
      data: cmd.data
    });
  }

  sendOkey(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_OK,
      data: cmd.data
    });
  }

  sendSubscribed(cmd: RealmCommand): void {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_ACK,
      qid: cmd.qid
    });
  }

  sendEndSubscribe(cmd: RealmCommand): void {
    this.foxSend({ id: cmd.id, rsp: RESULT_OK, qid: cmd.qid });
  }

  sendUnsubscribed(cmd: RealmCommand): void {
    this.foxSend({ id: cmd.id, rsp: RESULT_OK });
  }

  sendPublished(cmd: RealmCommand): void {
    this.foxSend({ id: cmd.id, rsp: RESULT_OK, qid: cmd.qid });
  }

  foxSend(msg: any, callback?: (err?: Error) => void): void {
    this.router.emit(SESSION_TX, this.session, JSON.stringify(msg));
    this.socketWriter.hyperPkgWrite(msg, callback);
  }

  foxClose(code: number, reason: string): void {
    this.socketWriter.hyperPkgClose(code, reason);
  }

  sendError(cmd: RealmCommand, errorCode: string | number, text?: string): void {
    this.foxSend({
      id: cmd.id,
      rsp: RESULT_ERR,
      data: { code: errorCode, message: text }
    });
  }
}

export class FoxGate extends BaseGate {
  createContext(session: Session, socketWriter: any): FoxSocketWriterContext {
    return new FoxSocketWriterContext(this.getRouter(), session, socketWriter);
  }

  checkRealm(session: Session, requestId: any): void {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized');
    }
  }

  sendWelcome(ctx: FoxSocketWriterContext, session: Session, cmd: RealmCommand): void {
    ctx.foxSend({
      id: cmd.id,
      rsp: RESULT_OK,
      data: {
        kv: {
          routerInfo: this.getRouter().getRouterInfo(),
          realmInfo: session.getRealmInfo()
        }
      }
    });
  }

  handle(ctx: FoxSocketWriterContext, session: Session, msg: any): void {
    this.getRouter().emit(SESSION_RX, session, JSON.stringify(msg));
    if (typeof msg !== 'object' || msg === null) {
      ctx.foxClose(1003, 'protocol violation');
      return;
    }
    const foxType = msg.ft;
    if (!handlers[foxType]) {
      console.log('Type Not Found', msg);
      ctx.foxClose(1003, 'protocol violation');
      return;
    }
    try {
      handlers[foxType].call(this, ctx, session, msg);
    } catch (err) {
      if (err instanceof RealmError) {
        ctx.sendError({ id: err.requestId }, err.code, err.message);
      } else {
        console.log('hyper-gate-error', foxType, err);
        throw err;
      }
    }
  }
}

handlers.LOGIN = function (ctx, session, message) {
  if (session.realm) {
    ctx.foxClose(1002, 'protocol violation');
    return;
  }

  const realmName = message.data && message.data.realm;
  session.realmName = realmName;
  session.secureDetails = message.data;

  const joinRealm = () => {
    this.getRouter().getRealm(realmName, (realm) => {
      realm.joinSession(session);
      ctx.foxSend({
        id: message.id,
        rsp: RESULT_OK
      });
    });
  };

  if (this.isAuthRequired(session)) {
    this._authHandler.auth(realmName, session.secureDetails, message.data && message.data.secret, (err: any, userDetails: any) => {
      if (err) {
        ctx.sendError({ id: message.id }, errorCodes.ERROR_NOT_AUTHORIZED, 'authentication_failed');
        return;
      }
      session.setUserDetails(userDetails);
      joinRealm();
    });
    return;
  }

  joinRealm();
};

handlers.ECHO = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'echo')) {
    return;
  }
  session.realm!.cmdEcho(ctx, message);
};

handlers.YIELD = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  session.realm!.cmdYield(ctx, message);
};

handlers.CONFIRM = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  session.realm!.cmdConfirm(ctx, message);
};

handlers.REG = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'register')) {
    return;
  }
  session.realm!.cmdRegRpc(ctx, message);
};

handlers.UNREG = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'unregister')) {
    return;
  }
  session.realm!.cmdUnRegRpc(ctx, message);
};

handlers.CALL = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'call')) {
    return;
  }
  session.realm!.cmdCallRpc(ctx, message);
};

handlers.TRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'subscribe')) {
    return;
  }
  session.realm!.cmdTrace(ctx, message);
};

handlers.UNTRACE = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'unsubscribe')) {
    return;
  }
  session.realm!.cmdUnTrace(ctx, message);
};

handlers.PUSH = function (ctx, session, message) {
  this.checkRealm(session, message.id);
  if (!this.checkAuthorize(ctx, message, 'publish')) {
    return;
  }
  session.realm!.cmdPush(ctx, message);
};

handlers.GOODBYE = function (ctx, session, message) {
  ctx.foxClose(1000, 'Server closed session');
};
