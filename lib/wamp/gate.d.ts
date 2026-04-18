import { BaseGate } from '../base_gate';
import Context from '../context';
import Router from '../router';
import Session from '../session';

export declare function toWampArgs(body: any): any[] | null;
export declare function parseWampArgs(args: any[]): any;
export declare function buildInvokeOpt(cmd: any): any;
export declare function buildEventOpt(cmd: any): any;

export declare class WampSocketWriterContext extends Context {
  socketWriter: any;
  constructor(router: Router, session: Session, socketWriter: any);
  wampSend(msg: any): void;
  sendWelcome(cmd: any): void;
  sendRegistered(cmd: any): void;
  sendUnregistered(cmd: any): void;
  sendInvoke(cmd: any): void;
  sendResult(cmd: any): void;
  sendError(cmd: any, errorCode: string, text?: string): void;
  sendEvent(cmd: any): void;
  sendSubscribed(cmd: any): void;
  sendUnsubscribed(cmd: any): void;
  sendPublished(cmd: any): void;
}

export declare class WampGate extends BaseGate {
  constructor(router: Router);
  getRouter(): Router;
  createContext(session: Session, socketWriter: any): WampSocketWriterContext;
  handle(ctx: WampSocketWriterContext, session: Session, msg: any): void;
}
