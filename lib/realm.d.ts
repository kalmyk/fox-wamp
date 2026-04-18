import { EventEmitter } from 'events';
import Context from './context';
import Router from './router';
import Session from './session';

export declare class Actor {
  ctx: Context;
  msg: any;
  constructor(ctx: Context, msg: any);
  getOpt(): any;
  rejectCmd(errorCode: string, text?: string): void;
  getSid(): string;
  getCustomId(): any;
  getSessionRealm(): BaseRealm | null;
  getEngine(): BaseEngine;
  isActive(): boolean;
}

export declare class ActorEcho extends Actor {
  okey(): void;
}

export declare class ActorCall extends Actor {
  engine: BaseEngine;
  destSID: Record<string, boolean>;
  registration: ActorReg;
  taskId: string | number;
  constructor(ctx: Context, msg: any);
  getHeaders(): any;
  getData(): any;
  getUri(): string;
  isActual(): boolean;
  setRegistration(registration: ActorReg): void;
  getRegistration(): ActorReg;
  responseArrived(actor: ActorYield): void;
}

export declare class ActorYield extends Actor {
  getHeaders(): any;
  getData(): any;
}

export declare class ActorTrace extends Actor {
  traceStarted: boolean;
  delayStack: any[];
  retained: boolean;
  retainedState: boolean;
  constructor(ctx: Context, msg: any);
  filter(event: any): boolean;
  sendEvent(cmd: any): void;
  filterSendEvent(event: any): void;
  delayEvent(cmd: any): void;
  flushDelayStack(): void;
  getUri(): string;
  atSubscribe(): void;
  atEndSubscribe(): void;
}

export declare class ActorReg extends ActorTrace {
  simultaneousTaskLimit: number;
  tasksRequested: number;
  subId: string | number;
  constructor(ctx: Context, msg: any);
  callWorker(taskD: ActorCall): void;
  isAble(): boolean;
  setSimultaneousTaskLimit(aLimit: number): void;
  taskResolved(): void;
  taskRequested(): void;
  getTasksRequestedCount(): number;
  atRegister(): void;
  atUnregister(): void;
}

export declare class ActorPush extends Actor {
  clientNotified: boolean;
  eventId: string | number | null;
  constructor(ctx: Context, msg: any);
  setEventId(eventId: string | number | null): void;
  getEventId(): string | number | null;
  confirm(cmd: any): void;
  getHeaders(): any;
  getData(): any;
  getUri(): string;
  needAck(): boolean;
  getEvent(): any;
}

export declare class DeferMap {
  defers: Map<string | number, ActorCall>;
  addDefer(actor: ActorCall, markId: string | number): string | number;
  getDefer(sid: string, markId: string | number): ActorCall | undefined;
  doneDefer(sid: string, markId: string | number): void;
}

export declare class BaseEngine {
  wSub: Record<string, Record<string | number, ActorReg>>;
  qCall: Map<string, ActorCall[]>;
  qYield: DeferMap;
  wTrace: any;
  _kvo: { uri: string, kv: any }[];
  realmName?: string;

  constructor();
  getRealmName(): string;
  launchEngine(realmName: string): Promise<void>;
  addKv(uri: string, kv: any): void;
  mkDeferId(): string | number;
  createActorEcho(ctx: Context, cmd: any): ActorEcho;
  createActorReg(ctx: Context, cmd: any): ActorReg;
  createActorCall(ctx: Context, cmd: any): ActorCall;
  createActorYield(ctx: Context, cmd: any): ActorYield;
  createActorTrace(ctx: Context, cmd: any): ActorTrace;
  createActorPush(ctx: Context, cmd: any): ActorPush;
  getSubStack(uri: string): Record<string | number, ActorReg>;
  waitForResolver(uri: string, taskD: ActorCall): void;
  addSub(uri: string, subD: ActorReg): void;
  removeSub(uri: string, id: string | number): void;
  checkTasks(subD: ActorReg): boolean;
  getPendingTaskCount(): number;
  doCall(taskD: ActorCall): null | undefined;
  makeTraceId(): string | number;
  matchTrace(uri: string): ActorTrace[];
  addTrace(subD: ActorTrace): void;
  removeTrace(uri: string, subscription: ActorTrace): void;
  doTrace(actor: ActorTrace): void;
  disperseToSubs(event: any): void;
  saveInboundHistory(actor: ActorPush): void;
  saveChangeHistory(actor: ActorPush): void;
  doPush(actor: ActorPush): void;
  updateKvFromActor(actor: ActorPush): Promise<any>;
  getKey(uri: string, cbRow: (key: string, data: any, eventId: any) => void): Promise<any[]>;
  cleanupSession(sessionId: string): Promise<any[]>;
  getHistoryAfter(after: any, uri: string, cbRow: (cmd: any) => void): Promise<void>;
}

export declare class BaseRealm extends EventEmitter {
  _wampApi: any;
  _hyperApi: any;
  _sessions: Map<string, Session>;
  _router: Router;
  _dict: any;
  engine: BaseEngine;

  constructor(router: Router, engine: BaseEngine);
  getRouter(): Router;
  getEngine(): BaseEngine;
  setDict(dict: any): void;
  cmdEcho(ctx: Context, cmd: any): void;
  cmdRegRpc(ctx: Context, cmd: any): string | number;
  cmdUnRegRpc(ctx: Context, cmd: any): string;
  cmdCallRpc(ctx: Context, cmd: any): string | number;
  cmdYield(ctx: Context, cmd: any): void;
  cmdConfirm(ctx: Context, cmd: any): void;
  cmdTrace(ctx: Context, cmd: any): string | number;
  cmdUnTrace(ctx: Context, cmd: any): string;
  cmdPush(ctx: Context, cmd: any): void;
  getSession(sessionId: string): Session | undefined;
  joinSession(session: Session): void;
  leaveSession(session: Session): Promise<any[]>;
  getSessionCount(): number;
  getSessionIds(): string[];
  getRealmInfo(): any;
  getSessionInfo(sessionId: string): any;
  buildApi(): any;
  api(): any;
  wampApi(): any;
  getKey(uri: string, cbRow: (key: string, data: any, eventId: any) => void): Promise<any[]>;
  runInboundEvent(sessionId: string, uri: string, bodyValue: any): void;
  registerKeyValueEngine(uri: string, kv: any): void;
}

export declare class ActorPushKv {
  uri: string;
  data: any;
  opt: any;
  eventId: string | number | null;
  constructor(uri: string, data: any, opt: any);
  getOpt(): any;
  getUri(): string;
  getSid(): string;
  getData(): any;
  setEventId(eventId: string | number | null): void;
  getEventId(): string | number | null;
  getEvent(): any;
  confirm(): void;
}

export declare class KeyValueStorageAbstract {
  uriPattern: string;
  saveChangeHistory: (actor: ActorPush) => void;
  runInboundEvent: (sessionId: string, uri: string, bodyValue: any) => void;
  constructor();
  setUriPattern(uriPattern: string): void;
  setSaveChangeHistory(saveChangeHistory: (actor: ActorPush) => void): void;
  setRunInboundEvent(runInboundEvent: (sessionId: string, uri: string, bodyValue: any) => void): void;
  getUriPattern(): string;
  getStrUri(actor: Actor): string;
}

export declare class TableDictionary {
  _tables: Map<string, any>;
  constructor();
  getTableDef(tableName: string): any;
  validateStruct(uri: string, data: any): void;
}

export declare function isBodyValueEmpty(bodyValue: any): boolean;
export declare function isDataEmpty(data: any): boolean;
export declare function isDataFit(when: any, data: any): boolean;
export declare function deepMerge(to: any, from: any): any;
export declare function deepDataMerge(oldData: any, newData: any): any;
export declare function makeDataSerializable(body: any): any;
export declare function unSerializeData(body: any): any;
