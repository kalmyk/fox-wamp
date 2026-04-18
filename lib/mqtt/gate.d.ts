import { BaseGate } from '../base_gate';
import Context from '../context';
import Router from '../router';
import Session from '../session';

export declare class MqttSocketWriterContext extends Context {
  socketWriter: any;
  constructor(router: Router, session: Session, socketWriter: any);
  mqttSend(msg: any): void;
  sendSubscribed(cmd: any): void;
  sendPublished(cmd: any): void;
  sendEvent(cmd: any): void;
}

export declare class MqttGate extends BaseGate {
  constructor(router: Router);
  getRouter(): Router;
  createContext(session: Session, socketWriter: any): MqttSocketWriterContext;
  handle(ctx: MqttSocketWriterContext, session: Session, data: any): void;
}
