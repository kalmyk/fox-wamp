import { BaseGate } from '../base_gate';
import Context from '../context';
import Router from '../router';
import Session from '../session';

export declare class FoxSocketWriterContext extends Context {
  socketWriter: any;
  constructor(router: Router, session: Session, socketWriter: any);
  foxSend(msg: any): void;
  sendRegistered(cmd: any): void;
  sendUnregistered(cmd: any): void;
  sendInvoke(cmd: any): void;
  sendResult(cmd: any): void;
  sendOkey(cmd: any): void;
  sendError(cmd: any, errorCode: string, text?: string): void;
  sendEvent(cmd: any): void;
  sendSubscribed(cmd: any): void;
  sendEndSubscribe(cmd: any): void;
  sendPublished(cmd: any): void;
  sendUnsubscribed(cmd: any): void;
}

export declare class FoxGate extends BaseGate {
  constructor(router: Router);
  getRouter(): Router;
  createContext(session: Session, socketWriter: any): FoxSocketWriterContext;
  handle(ctx: FoxSocketWriterContext, session: Session, msg: any): void;
}
