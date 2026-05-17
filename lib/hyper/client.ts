import { defaultParse, restoreUri } from '../topic_pattern';
import { Context } from '../context';
import { Session } from '../session';
import { RESULT_OK, RESULT_ACK, RESULT_EMIT, RESULT_ERR,
  REQUEST_TASK, REQUEST_EVENT } from '../messages';
import { errorCodes } from '../realm_error';
import { getBodyValue } from '../base_gate';
import { parseHyperBody } from './gate';

export type CallbackFn = (...args: any[]) => any;

function localAck(action: any, cmd: any): void {
  action.resolve(cmd.qid);
}

function localOkey(action: any, cmd: any): void {
  action.resolve(getBodyValue(cmd.data));
}

function localError(action: any, cmd: any): void {
  action.reject(cmd.data);
}

function localEvent(action: any, cmd: any): void {
  const eventOpt = {
    publisher: cmd.sid,
    publication: cmd.qid,
    topic: restoreUri(cmd.uri),
    // retained: false,
    headers: cmd.hdr
  };
  action.cb(getBodyValue(cmd.data), eventOpt);
}

function localEmit(action: any, cmd: any): void {
  action.cb(getBodyValue(cmd.data));
}

function localInvoke(ctx: Context, realm: any, action: any, cmd: any): void {
  const callOpt = Object.assign(
    {
      procedure: restoreUri(cmd.uri),
      progress: (progressBody: any, opt: any) => {
        realm.cmdYield(ctx, {
          qid: cmd.qid,
          rqt: RESULT_EMIT,
          data: parseHyperBody(progressBody),
          opt: opt
        });
      },
      headers: cmd.hdr
    },
    cmd.opt
  );
  try {
    const taskResult = action.cb(getBodyValue(cmd.data), callOpt);
    Promise.resolve(taskResult).then(result => {
      realm.cmdYield(ctx, {
        rqt: RESULT_OK,
        qid: cmd.qid,
        data: parseHyperBody(result)
      });
    }).catch(e => {
        realm.cmdYield(ctx, {
          rqt: RESULT_ERR,
          qid: cmd.qid,
          err: errorCodes.ERROR_CALLEE_FAILURE,
          data: e.message
        });
    });
  } catch (e: any) {
    realm.cmdYield(ctx, {
      rqt: RESULT_ERR,
      qid: cmd.qid,
      err: errorCodes.ERROR_CALLEE_FAILURE,
      data: e.message
    });
  }
}

export class HyperApiContext extends Context {
  private _realm: any;

  constructor(router: any, session: any, realm: any) {
    super(router, session);
    this._realm = realm;
  }

  sendInvoke(cmd: any): void {
    localInvoke(this, this._realm, cmd.id, cmd);
  }

  sendResult(cmd: any): void {
    if (cmd.rsp === RESULT_EMIT) {
      localEmit(cmd.id, cmd);
    } else {
      localOkey(cmd.id, cmd);
    }
  }

  sendEvent(cmd: any): void {
    localEvent(cmd.id, cmd);
  }

  sendOkey(cmd: any): void {
    localOkey(cmd.id, cmd);
  }

  sendRegistered(cmd: any): void {
    localAck(cmd.id, cmd);
  }

  sendUnregistered(cmd: any): void {
    localOkey(cmd.id, cmd);
  }

  sendSubscribed(cmd: any): void {
    if (cmd.id.snapshot) {
      return;
    }
    localAck(cmd.id, cmd);
  }

  sendUnsubscribed(cmd: any): void {
    localOkey(cmd.id, cmd);
  }

  sendEndSubscribe(cmd: any): void {
    if (cmd.id.snapshot) {
      localAck(cmd.id, cmd);
    } else {
      localOkey(cmd.id, cmd);
    }
  }

  sendPublished(cmd: any): void {
    localAck(cmd.id, cmd);
  }

  sendError(cmd: any, code: any, text: any): void {
    if (cmd.id && cmd.id.reject) {
      cmd.id.reject({ error: code, message: text });
    }
  }
}

export class HyperClient {
  protected _session?: Session

  constructor(protected realm: any, protected ctx: Context) {}

  // Return associated Session object. By default throws if not set.
  public session(): Session {
    if (this._session) return this._session
    throw new Error('HyperClient.session() is not set for this client')
  }

  // Set the associated Session. Used by transports / realm builders.
  public setSession(session: Session): void {
    this._session = session
  }

  afterOpen(callback: CallbackFn): any {
    return callback();
  }

  echo(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.realm.cmdEcho(this.ctx, {
        id: { resolve, reject },
        data: parseHyperBody(data)
      });
    });
  }

  // API functions
  // register callback = function(id, args, kwargs, opt)
  register(uri: string, cb: CallbackFn, opt?: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.realm.cmdRegRpc(this.ctx, {
        id: { cb, resolve, reject },
        uri: defaultParse(uri),
        opt: opt || {}
      });
    });
  }

  unregister(regId: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // todo: restoreUri(
      this.realm.cmdUnRegRpc(this.ctx, {
        id: { resolve, reject },
        unr: regId
      });
    });
  }

  callrpc(uri: string, data: any, opt?: any): Promise<any> {
    const callOpt = opt || {};
    const progress_cb = callOpt.progress;
    const finalOpt = { ...callOpt };
    delete (finalOpt as any).progress;
    return new Promise((resolve, reject) => {
      this.realm.cmdCallRpc(this.ctx, {
        id: { cb: progress_cb, resolve, reject },
        uri: defaultParse(uri),
        data: parseHyperBody(data),
        opt: finalOpt
      });
    });
  }

  // event (data, opt)
  // resolve traceId
  subscribe(uri: string, cb: CallbackFn, opt?: any): Promise<any> {
    const finalOpt = opt || {};
    return new Promise((resolve, reject) => {
      return this.realm.cmdTrace(this.ctx, {
        id: { cb, resolve, reject, snapshot: finalOpt.snapshot === true },
        uri: defaultParse(uri),
        opt: finalOpt
      });
    });
  }

  unsubscribe(subId: any): Promise<any> {
    return new Promise((resolve, reject) => {
      // todo: restoreUri(
      this.realm.cmdUnTrace(this.ctx, {
        id: { resolve, reject },
        unr: subId
      });
    });
  }

  publish(uri: string, data: any, opt: any = {}): Promise<any> {
    if (opt.exclude_me !== false) {
      opt.exclude_me = true;
    }
    let result: Promise<any>;
    let subContainer: any = undefined;
    let ack = false;
    if ('acknowledge' in opt) {
      ack = true;
      const finalOpt = { ...opt };
      delete (finalOpt as any).acknowledge;
      subContainer = {};
      result = new Promise((resolve, reject) => {
        subContainer.resolve = resolve;
        subContainer.reject = reject;
      });
      opt = finalOpt;
    } else {
      result = Promise.resolve();
    }
    let headers: any;
    if ('headers' in opt) {
      headers = opt.headers;
      const finalOpt = { ...opt };
      delete (finalOpt as any).headers;
      opt = finalOpt;
    } else {
      headers = {};
    }
    // do not wait if no ack in request
    this.realm.cmdPush(this.ctx, {
      id: subContainer,
      uri: defaultParse(uri),
      opt,
      data: parseHyperBody(data),
      hdr: headers,
      ack
    });
    return result;
  }

  // this:readEventsClient .pipe(writeEventTo: Client, topic)
  pipe(writeToClient: HyperClient, topic: string, pipeOpt?: any): Promise<any> {
    return this.subscribe(topic, (body, opt) => {
      const newOpt = Object.assign({}, pipeOpt);
      if (opt && opt.headers) {
        newOpt.headers = opt.headers;
      }
      writeToClient.publish(opt.topic, body, newOpt);
    });
  }
}

// implements realm interface
export class HyperSocketFormatter {
  private commandId = 0;
  private cmdList = new Map<number, any>();

  constructor(private socketWriter: any) {}

  sendCommand(id: any, command: any): number {
    command.id = ++this.commandId;
    this.cmdList.set(this.commandId, id);

    this.socketWriter.hyperPkgWrite(command);
    return this.commandId;
  }

  cmdEcho(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'ECHO', data: cmd.data });
  }

  cmdRegRpc(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'REG', uri: cmd.uri, opt: cmd.opt });
  }

  cmdUnRegRpc(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'UNREG', unr: cmd.unr });
  }

  cmdCallRpc(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'CALL', uri: cmd.uri, data: cmd.data, opt: cmd.opt });
  }

  cmdTrace(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'TRACE', uri: cmd.uri, opt: cmd.opt });
  }

  cmdUnTrace(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'UNTRACE', unr: cmd.unr });
  }

  cmdPush(ctx: Context, cmd: any): number {
    return this.sendCommand(cmd.id, { ft: 'PUSH', uri: cmd.uri, data: cmd.data, hdr: cmd.hdr, opt: cmd.opt, ack: cmd.ack });
  }

  cmdYield(ctx: Context, cmd: any): void {
    this.socketWriter.hyperPkgWrite(Object.assign({ ft: 'YIELD' }, cmd));
  }

  private settle(action: any, cmd: any): boolean {
    const mode = cmd.rsp || '';

    switch (mode) {
      case RESULT_ACK: localAck(action, cmd); return false;
      case RESULT_OK: localOkey(action, cmd); return true;
      case RESULT_ERR: localError(action, cmd); return true;
      case RESULT_EMIT: localEmit(action, cmd); return false;
      case REQUEST_EVENT: localEvent(action, cmd); return false;
      case REQUEST_TASK: localInvoke(this as any, this as any, action, cmd); return false;
      default:
        if (action.reject) {
          action.reject(cmd.data);
        }
        return true;
    }
  }

  onMessage = (msg: any): void => {
    if (msg.id && this.cmdList.has(msg.id)) {
      const action = this.cmdList.get(msg.id);
      if (this.settle(action, msg)) {
        this.cmdList.delete(msg.id);
      }
    } else {
      // unknown command ID arrived, nothing to do, could write error?
      console.log('UNKNOWN PACKAGE', msg);
    }
  };
}

export type OnOpenCallback = () => void | Promise<void>;

export class RemoteHyperClient extends HyperClient {
  private atOpenCallbacks: OnOpenCallback[] = [];

  constructor(formatter: any) {
    super(formatter, formatter);
  }

  onopen(callback: OnOpenCallback): void {
    if (typeof callback === 'function') {
      this.atOpenCallbacks.push(callback);
    } else {
      throw new Error('onopen callback must be a function');
    }
  }

  async applyOnOpen(): Promise<void> {
    for (const callback of this.atOpenCallbacks) {
      await callback();
    }
  }

  private cmdLogin(cmd: any): number {
    return (this.realm as HyperSocketFormatter).sendCommand(cmd.id, { ft: 'LOGIN', data: cmd.data });
  }

  login(data: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.cmdLogin({
        id: { resolve, reject },
        data: data
      });
    });
  }
}
