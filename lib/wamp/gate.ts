import WAMP from './protocol'
import { RealmError, errorCodes } from '../realm_error'
import { wampErrorCode } from './msg'
import { wampUriParse, restoreUri } from '../topic_pattern'
import { RESULT_EMIT, RESULT_OK } from '../messages'
import { getBodyValue, BaseGate } from '../base_gate'
import { Context } from '../context'
import { Router } from '../router'
import { Session } from '../session'

const handlers: { [key: number]: Function } = {};

export function toWampArgs(body: any): any[] | null {
  let value = getBodyValue(body);
  if (value === null || Array.isArray(value)) {
    return value;
  }
  return [value];
}

export function parseWampArgs(args: any[]): any {
  return { args: args };
}

export function buildInvokeOpt(cmd: any): any {
  let invOpts: any = {};
  if (cmd.opt.receive_progress) {
    invOpts.receive_progress = true;
  }
  return invOpts;
}

export function buildEventOpt(cmd: any): any {
  let eventOpt: any = {
    topic: restoreUri(cmd.uri),
    publisher: cmd.sid
    // publisher_authid: undefined,
    // publisher_authrole: undefined,
  };
  if (cmd.opt.retained) {
    eventOpt.retained = true;
  }
  return eventOpt;
}

export class WampSocketWriterContext extends Context {
  public socketWriter: any;
  public msgType?: number;

  constructor(router: Router, session: Session, socketWriter: any) {
    super(router, session);
    this.socketWriter = socketWriter;
  }

  public setWampType(msgType: number): void {
    this.msgType = msgType;
  }

  public sendRegistered(cmd: any): void {
    this.wampSend([WAMP.REGISTERED, cmd.id, cmd.qid]);
  }

  public sendUnregistered(cmd: any): void {
    if (cmd.id) { // do not send on disconnect
      this.wampSend([WAMP.UNREGISTERED, cmd.id]);
    }
  }

  public sendInvoke(cmd: any): void {
    this.wampSend([
      WAMP.INVOCATION,
      cmd.qid,
      cmd.subId,
      buildInvokeOpt(cmd),
      toWampArgs(cmd.data),
      cmd.hdr // kwargs
    ]);
  }

  public sendResult(cmd: any): void {
    if (cmd.err) {
      this.wampSendError(WAMP.CALL, cmd.id, wampErrorCode(cmd.err), [cmd.data]);
      return;
    }
    let resOpt: any = {};
    if (cmd.rsp === RESULT_EMIT) {
      resOpt.progress = true;
    }
    this.wampSend([
      WAMP.RESULT,
      cmd.id,
      resOpt,
      toWampArgs(cmd.data),
      cmd.hdr // kwargs
    ]);
  }

  public sendEvent(cmd: any): void {
    this.wampSend([
      WAMP.EVENT,
      cmd.traceId,
      cmd.qid,
      buildEventOpt(cmd),
      toWampArgs(cmd.data),
      cmd.hdr // kwargs
    ]);
  }

  public sendSubscribed(cmd: any): void {
    this.wampSend([WAMP.SUBSCRIBED, cmd.id, cmd.qid]);
  }

  public sendEndSubscribe(cmd: any): void {}

  public sendPublished(cmd: any): void {
    this.wampSend([WAMP.PUBLISHED, cmd.id, cmd.qid]);
  }

  public sendUnsubscribed(cmd: any): void {
    this.wampSend([WAMP.UNSUBSCRIBED, cmd.id]);
  }

  public sendError(cmd: any, errorCode: string, text?: string): void {
    let args: any[] = [];
    if (text) {
      args.push(text);
    }
    return this.wampSendError(this.msgType!, cmd.id, wampErrorCode(errorCode), args);
  }

  public wampSendError(mtype: number, requestId: number | string, wampCode: string, args: any[], kwargs?: any): void {
    if (requestId) { // do not send on disconnect
      let msg: any[] = [WAMP.ERROR, mtype, requestId, {}, wampCode, args];
      if (kwargs) {
        msg.push(kwargs);
      }
      this.wampSend(msg);
    }
  }

  public wampSend(msg: any[], callback?: Function): void {
    this.socketWriter.wampPkgWrite(msg, callback);
  }

  public wampClose(code: number, reason: string): void {
    this.socketWriter.wampPkgClose(code, reason);
  }
}

export class WampGate extends BaseGate {
  public createContext(session: Session, socketWriter: any): WampSocketWriterContext {
    return new WampSocketWriterContext(this.getRouter(), session, socketWriter);
  }

  public hello(ctx: WampSocketWriterContext, session: Session, realmName: string, details: any): void {
    session.realmName = realmName;
    session.secureDetails = details;
    if (!this.isAuthRequired(session)) {
      this.getRouter().getRealm(realmName, (realm: any) => {
        session.setAuthMethod('anonymous');
        realm.joinSession(session);
        let welcomeInfo = this.makeRealmDetails(session.realmName!);
        welcomeInfo.authmethod = session.getAuthMethod();
        this.sendWelcome(ctx, session.sessionId, welcomeInfo);
      });
      return;
    }

    let methods = details.hasOwnProperty('authmethods') && Array.isArray(details.authmethods) ? details.authmethods : [];
    let authMethod = this.getAcceptedAuthMethod(methods);
    if (authMethod) {
      session.setAuthMethod(authMethod);
      let extra = {};
      if (typeof this._authHandler[authMethod + '_extra'] === 'function') {
        this._authHandler[authMethod + '_extra'](session.realmName, session.secureDetails, (err: any, extraObj: any) => {
          if (err) {
            this.sendAbort(ctx, 'wamp.error.no_auth_method');
          } else {
            this.sendChallenge(ctx, authMethod, extraObj);
          }
        });
        return;
      }
      this.sendChallenge(ctx, authMethod, extra);
    } else {
      this.sendAbort(ctx, 'wamp.error.no_auth_method');
    }
  }

  public authenticate(ctx: WampSocketWriterContext, session: Session, secret: string, extra: any): void {
    let authMethod = session.getAuthMethod();
    this._authHandler[authMethod + '_auth'](session.realmName, session.secureDetails, secret, extra, (err: any, userDetails: any) => {
      if (err) {
        this.sendAbort(ctx, 'wamp.error.authentication_failed');
      } else {
        session.setUserDetails(userDetails);
        this.getRouter().getRealm(session.realmName!, (realm: any) => {
          realm.joinSession(session);
          let welcomeInfo = this.makeRealmDetails(session.realmName!);
          welcomeInfo.authid = session.secureDetails.authid;
          welcomeInfo.authmethod = session.authmethod;
          this.sendWelcome(ctx, session.sessionId, welcomeInfo);
        });
      }
    });
  }

  public makeRealmDetails(realmName: string): any {
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
    };
  }

  public checkRealm(session: Session, requestId: any): void {
    if (!session.realm) {
      throw new RealmError(requestId, 'wamp.error.not_authorized');
    }
  }

  public sendWelcome(ctx: WampSocketWriterContext, sessionId: string, details: any): void {
    ctx.wampSend([WAMP.WELCOME, sessionId, details]);
  }

  public sendChallenge(ctx: WampSocketWriterContext, authmethod: string, extra: any): void {
    ctx.wampSend([WAMP.CHALLENGE, authmethod, extra]);
  }

  public sendGoodbye(ctx: WampSocketWriterContext): void {
    // Graceful termination
    var msg = [WAMP.GOODBYE, {}, 'wamp.error.goodbye_and_out'];
    ctx.wampSend(msg, () => {
      ctx.wampClose(1000, 'Server closed WAMP session');
    });
  }

  public sendAbort(ctx: WampSocketWriterContext, reason: string): void { // auth failed
    var msg = [WAMP.ABORT, {}, reason];
    ctx.wampSend(msg, () => {
      ctx.wampClose(1000, 'Server closed WAMP session');
    });
  }

  public handle(ctx: WampSocketWriterContext, session: Session, msg: any[]): void {
    if (!Array.isArray(msg)) {
      ctx.wampClose(1003, 'protocol violation');
      return;
    }
    var mtype = msg.shift();
    if (!handlers[mtype]) {
      ctx.wampClose(1003, 'protocol violation');
      return;
    }
    ctx.setWampType(mtype);
    try {
      handlers[mtype].call(this, ctx, session, msg);
    } catch (err: any) {
      if (err instanceof RealmError) {
        ctx.wampSendError(mtype, err.requestId, wampErrorCode(err.code), [err.message]);
      } else {
        throw err;
      }
    }
  }
}

handlers[WAMP.HELLO] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  const realmName = message.shift();
  const details = message.shift();
  if (session.realm === null) {
    this.hello(ctx, session, realmName, details);
  } else {
    ctx.wampClose(1002, 'protocol violation');
  }
  return false;
};

handlers[WAMP.AUTHENTICATE] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  const secret = message.shift();
  const extra = message.shift();
  if (session.realm === null) {
    this.authenticate(ctx, session, secret, extra);
  } else {
    ctx.wampClose(1002, 'protocol violation');
  }
};

handlers[WAMP.GOODBYE] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  this.sendGoodbye(ctx);
};

handlers[WAMP.REGISTER] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  let id = message.shift();
  let inopt = message.shift();
  let uri = wampUriParse(message.shift());

  this.checkRealm(session, id);

  let opt: any = {};
  if (Number.isInteger(inopt.concurrency)) {
    opt.simultaneousTaskLimit = inopt.concurrency;
  } else {
    // set simultaneous tasks unlimited
    opt.simultaneousTaskLimit = -1;
  }

  if (inopt.reducer) {
    opt.reducer = true;
  }

  const cmd: any = { id, uri, opt };
  if (!this.checkAuthorize(ctx, cmd, 'register')) {
    return;
  }
  session.realm!.cmdRegRpc(ctx, cmd);
};

handlers[WAMP.CALL] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  var id = message.shift();
  var opt = message.shift() || {};
  var uri = wampUriParse(message.shift());
  var args = message.shift() || [];
  var kwargs = message.shift() || {};

  this.checkRealm(session, id);
  let cmd: any = {
    id,
    uri,
    opt: {},
    hdr: kwargs,
    data: parseWampArgs(args)
  };
  if (opt.receive_progress) {
    cmd.opt.receive_progress = true;
  }
  if (!this.checkAuthorize(ctx, cmd, 'call')) {
    return;
  }
  session.realm!.cmdCallRpc(ctx, cmd);
};

handlers[WAMP.CANCEL] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
};

handlers[WAMP.UNREGISTER] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  var id = message.shift();
  var unr = message.shift();

  this.checkRealm(session, id);
  session.realm!.cmdUnRegRpc(ctx, { id, unr });
};

handlers[WAMP.YIELD] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  var qid = message.shift();
  var opt = message.shift();
  var args = message.shift() || [];
  var kwargs = message.shift();
  this.checkRealm(session, qid);

  let cmd: any = {
    qid,
    hdr: kwargs,
    data: parseWampArgs(args),
    opt
  };
  if (opt && opt.progress) {
    cmd.rqt = RESULT_EMIT;
    delete opt.progress;
  } else {
    cmd.rqt = RESULT_OK;
  }

  session.realm!.cmdYield(ctx, cmd);
};

handlers[WAMP.SUBSCRIBE] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  const id = message.shift();
  const opt = message.shift();
  const uri = wampUriParse(message.shift());

  this.checkRealm(session, id);
  const cmd = { id, uri, opt };
  if (this.checkAuthorize(ctx, cmd, 'subscribe')) {
    session.realm!.cmdTrace(ctx, cmd);
  }
};

handlers[WAMP.UNSUBSCRIBE] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  const id = message.shift();
  const unr = message.shift();

  this.checkRealm(session, id);
  session.realm!.cmdUnTrace(ctx, { id, unr });
};

handlers[WAMP.PUBLISH] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  const id = message.shift();
  const opt = message.shift() || {};
  const uri = wampUriParse(message.shift());
  const args = message.shift() || null;
  const kwargs = message.shift() || null;

  const cmd: any = {
    id,
    uri,
    hdr: kwargs,
    data: parseWampArgs(args)
  };

  if (opt.acknowledge) {
    cmd.ack = true;
  }
  delete opt.acknowledge;

  if (opt.exclude_me !== false) {
    opt.exclude_me = true;
  }

  cmd.opt = opt;

  this.checkRealm(session, id);
  if (this.checkAuthorize(ctx, cmd, 'publish')) {
    session.realm!.cmdPush(ctx, cmd);
  }
};

handlers[WAMP.ERROR] = function (this: WampGate, ctx: WampSocketWriterContext, session: Session, message: any[]) {
  let requestType = message.shift();
  let qid = message.shift();
  /* let opt = */ message.shift();
  let errorText = message.shift();

  this.checkRealm(session, qid);
  const code = errorCodes.ERROR_CALLEE_FAILURE;
  if (requestType === WAMP.INVOCATION) {
    session.realm!.cmdYield(ctx, {
      qid,
      err: code,
      data: errorText
    });
  }

  return false;
};
