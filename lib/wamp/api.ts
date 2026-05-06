import { wampErrorCode } from './msg'
import { errorCodes } from '../realm_error'
import { RESULT_EMIT } from '../messages'
import { wampUriParse, restoreUri } from '../topic_pattern'
import { Session } from '../session'
import { Context } from '../context'
import { parseWampArgs, toWampArgs, buildInvokeOpt, buildEventOpt } from './gate'
import { BaseRealm } from '../realm'

export class WampApiContext extends Context {
  public sendInvoke(cmd: any): void {
    cmd.id.cb(cmd.qid, toWampArgs(cmd.data), cmd.hdr, buildInvokeOpt(cmd));
  }

  public sendResult(cmd: any): void {
    if (cmd.err) {
      cmd.id.reject({ code: wampErrorCode(cmd.err), message: cmd.data });
    } else {
      const args = toWampArgs(cmd.data);
      const kwargs = cmd.hdr;
      if (cmd.rsp === RESULT_EMIT) {
        cmd.id.cb(args, kwargs);
      } else {
        cmd.id.resolve({ args, kwargs });
      }
    }
  }

  public sendEvent(cmd: any): void {
    cmd.id.cb(cmd.qid, toWampArgs(cmd.data), cmd.hdr, buildEventOpt(cmd));
  }

  public sendRegistered(cmd: any): void {
    cmd.id.resolve(cmd.qid);
  }

  public sendUnregistered(cmd: any): void {}

  public sendSubscribed(cmd: any): void {
    cmd.id.resolve(cmd.qid);
  }

  public sendUnsubscribed(cmd: any): void {}

  public sendEndSubscribe(cmd: any): void {}

  public sendPublished(cmd: any): void {
    cmd.id.resolve(cmd.qid);
  }

  public sendError(cmd: any, code: string, text?: string): void {
    if (cmd.id && cmd.id.reject) {
      cmd.id.reject({ error: wampErrorCode(code), message: text });
    }
  }
}

export class WampApi extends Session {
  public register: (uri: string, cb: Function) => Promise<any>;
  public unregister: (regId: string) => string;
  public callrpc: (uri: string, args: any[], kwargs?: any, cb?: Function, opt?: any) => Promise<any>;
  public resrpc: (qid: string, err: string | null, args: any[], kwargs?: any, opt?: any) => void;
  public subscribe: (uri: string, cb: Function, opt?: any) => Promise<any>;
  public unsubscribe: (topicId: string) => string;
  public publish: (uri: string, args: any[], kwargs?: any, opt?: any) => Promise<any>;
  public getGateProtocol: () => string;

  constructor(realm: BaseRealm, sessionId: string) {
    super(sessionId);

    const ctx = new WampApiContext(realm.getRouter(), this);

    // API functions
    // register callback = function(id, args, kwargs, opt)
    this.register = function (uri: string, cb: Function): Promise<any> {
      return new Promise((resolve, reject) => {
        realm.cmdRegRpc(ctx, {
          id: { cb, resolve, reject },
          uri: wampUriParse(uri),
          opt: {}
        });
      });
    };

    this.unregister = function (regId: string): string {
      return restoreUri(
        realm.cmdUnRegRpc(ctx, {
          unr: regId
        }) as unknown as string[]
      );
    };

    this.callrpc = function (uri: string, args: any[], kwargs?: any, cb?: Function, opt?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        realm.cmdCallRpc(ctx, {
          id: { cb, resolve, reject },
          uri: wampUriParse(uri),
          hdr: kwargs,
          data: parseWampArgs(args),
          opt: opt || {}
        });
      });
    };

    this.resrpc = function (qid: string, err: string | null, args: any[], kwargs?: any, opt?: any): void {
      if (err) {
        return realm.cmdYield(ctx, {
          qid,
          err: errorCodes.ERROR_CALLEE_FAILURE,
          hdr: kwargs,
          data: err,
          opt: opt || {}
        });
      }
      return realm.cmdYield(ctx, {
        qid,
        err,
        hdr: kwargs,
        data: parseWampArgs(args),
        opt: opt || {}
      });
    };

    // event (args, headers, opt.publication)
    // resolve traceId
    this.subscribe = function (uri: string, cb: Function, opt?: any): Promise<any> {
      return new Promise((resolve, reject) => {
        return realm.cmdTrace(ctx, {
          id: { cb, resolve, reject },
          uri: wampUriParse(uri),
          opt: opt || {}
        });
      });
    };

    this.unsubscribe = function (topicId: string): string {
      return restoreUri(realm.cmdUnTrace(ctx, {
        unr: topicId
      }) as unknown as string[]);
    };

    this.publish = function (uri: string, args: any[], kwargs?: any, opt?: any): Promise<any> {
      opt = opt || {};
      if (opt.exclude_me !== false) {
        opt.exclude_me = true;
      }
      if ('will' in opt) {
        opt.will = parseWampArgs(opt.will);
      }
      let result: Promise<any>;
      let subContainer: any;
      let ack: boolean | undefined;
      if (opt.acknowledge) {
        ack = true;
        delete opt.acknowledge;
        subContainer = {};
        result = new Promise((resolve, reject) => {
          subContainer.resolve = resolve;
          subContainer.reject = reject;
        });
      } else {
        result = Promise.resolve();
      }
      // do not wait if no ack in request
      realm.cmdPush(ctx, {
        id: subContainer,
        uri: wampUriParse(uri),
        opt,
        hdr: kwargs,
        data: parseWampArgs(args),
        ack
      });
      return result;
    };

    // gate override/internal part
    this.getGateProtocol = function (): string {
      return 'internal.wamp.api';
    };
  }
}
