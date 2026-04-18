import { BaseRealm, BaseEngine } from './realm';
import Context from './context';

declare class Session {
  realmName?: string;
  secureDetails?: any;
  authmethod: string;
  gateProtocol: string;
  realm: BaseRealm | null;
  sessionId: string;

  constructor(sessionId: string);

  getSid(): string;
  setAuthMethod(method: string): void;
  getAuthMethod(): string;
  setUserDetails(details: any): void;
  getUserDetails(): any;
  setRealm(realm: BaseRealm | null): void;
  addTrace(id: string | number, actor: any): void;
  getTrace(id: string | number): any;
  removeTrace(engine: BaseEngine, id: string | number): any;
  cleanupTrace(engine: BaseEngine): number;
  addSub(id: string | number, subD: any): void;
  getSub(id: string | number): any;
  removeSub(engine: BaseEngine, id: string | number): any;
  cleanupReg(engine: BaseEngine): number;
  setDisconnectPublish(ctx: Context, cmd: any): void;
  cleanDisconnectPublish(): void;
  genSessionMsgId(): number;
  waitForId(id: any, customId: any): void;
  fetchWaitId(customId: any): any;
  setLastPublishedId(id: string | number): void;
  getLastPublishedId(): string | number;
  cleanup(): Promise<any>;
  setSendFailed(e: Error): void;
  hasSendError(): boolean;
  firstSendErrorMessage(): string | undefined;
  isActive(): boolean;
  getGateProtocol(): string;
  setGateProtocol(protocolName: string): string;
  getRealmInfo(): any;
  getRealmName(): string | undefined;
}

export = Session;
