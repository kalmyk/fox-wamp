import Router from './router';
import Session from './session';

declare class Context {
  router: Router;
  session: Session;
  constructor(router: Router, session: Session);
  getSession(): Session;
  isActive(): boolean;
  emit(event: string, message: any, data?: any): void;
  setSendFailed(e: Error): void;
  sendInvoke?(msg: any, qid: any, uri: any, subId: any, hdr: any, data: any, opt: any): void;
  sendResult?(result: any): void;
  sendEvent?(cmd: any): void;
  sendAck?(msg: any): void;
  sendError?(msg: any, errorCode: string, text?: string): void;
  sendOkey?(msg: any): void;
  sendSubscribed?(msg: any): void;
  sendEndSubscribe?(msg: any): void;
  sendRegistered?(msg: any): void;
  sendUnregistered?(msg: any): void;
  sendPublished?(result: any): void;
  sendUnsubscribed?(msg: any): void;
}

export = Context;
