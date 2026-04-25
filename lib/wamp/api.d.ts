import Session from '../session';
import Context from '../context';
import { BaseRealm } from '../realm';

export declare class WampApiContext extends Context {
  sendInvoke(cmd: any): void;
  sendResult(cmd: any): void;
  sendEvent(cmd: any): void;
  sendRegistered(cmd: any): void;
  sendUnregistered(cmd: any): void;
  sendSubscribed(cmd: any): void;
  sendUnsubscribed(cmd: any): void;
  sendEndSubscribe(cmd: any): void;
  sendPublished(cmd: any): void;
}

declare class WampApi extends Session {
  constructor(realm: BaseRealm, sessionId: string);
  call(uri: string, args: any[], kwargs?: any): Promise<any>;
  subscribe(uri: string, cb: Function, opt?: any): Promise<any>;
  publish(uri: string, args: any[], kwargs?: any, opt?: any): Promise<any>;
  register(uri: string, cb: Function, opt?: any): Promise<any>;
  unregister(registrationId: string): string;
  resrpc(id: string, err: string | null, args: any[], kwargs?: any, opt?: any): void;
  callrpc(uri: string, args: any[], kwargs?: any, cb?: Function, opt?: any): Promise<any>;
  unsubscribe(topic: string): string;
}

export = WampApi;
