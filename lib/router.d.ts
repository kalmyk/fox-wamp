import { EventEmitter } from 'events';
import Session from './session';
import { BaseRealm } from './realm';

declare class Router extends EventEmitter {
  _realms: Map<string, BaseRealm>;
  _sessions: Map<string, Session>;
  _id: string;

  constructor();

  setId(id: string): void;
  getId(): string;
  setLogTrace(trace: boolean): void;
  trace(...args: any[]): void;
  makeSessionId(): string;
  createSession(): Session;
  registerSession(session: Session): void;
  removeSession(session: Session): void;
  getSession(sessionId: string): Session | undefined;
  getRouterInfo(): any;
  createRealm(realmName: string): BaseRealm;
  initRealm(realmName: string, realm: BaseRealm): Promise<void>;
  findRealm(realmName: string): BaseRealm | undefined;
  getRealm(realmName: string, callback?: (realm: BaseRealm) => void | Promise<void>): Promise<BaseRealm>;
}

export = Router;
