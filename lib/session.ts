import { BaseRealm, BaseEngine } from './realm';
import { Context } from './context';
import { RealmCommand } from './types';

export class Session {
  public realmName?: string = undefined;
  public secureDetails?: any = undefined;
  public authmethod: string = 'unknown';
  public gateProtocol: string = 'unknown.gate';
  public realm: BaseRealm | null = null;
  public sessionId: string;

  private willPublishCtx?: Context;
  private willPublishCmd?: RealmCommand;
  private sessionMsgId: number = 0;
  private lastPublishedId: string = '';
  private publishMap: Map<any, any> = new Map();
  private userDetails: any = {};
  private active: boolean = true; // not terminated
  private firstSendErrorMessageState?: string;

  /**
   * trace commands
   * [id] => actor
   */
  private sTrace: Map<string, any> = new Map();

  /**
   * subscribtion commands
   * [id] => actor
   */
  private sSub: Map<string, any> = new Map();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  public getSid(): string {
    return this.sessionId;
  }

  public setAuthMethod(method: string): void {
    this.authmethod = method;
  }

  public getAuthMethod(): string {
    return this.authmethod;
  }

  public setUserDetails(details: any): void {
    this.userDetails = details;
  }

  public getUserDetails(): any {
    return this.userDetails;
  }

  /**
   * use realm.joinSession to connect to the realm
   */
  public setRealm(realm: BaseRealm | null): void {
    this.realm = realm;
  }

  public addTrace(id: string, actor: any): void {
    this.sTrace.set(id, actor);
  }

  public getTrace(id: string): any {
    return this.sTrace.get(id);
  }

  public removeTrace(engine: BaseEngine, id: string): any {
    let actor: any = false;
    if (this.sTrace.has(id)) {
      actor = this.sTrace.get(id);
      this.sTrace.delete(id);
      engine.removeTrace(actor.getUri(), actor);
    }
    return actor;
  }

  public cleanupTrace(engine: BaseEngine): number {
    const tmp: string[] = [];
    let deletedCount = 0;
    for (const [key] of this.sTrace) {
      tmp.push(key);
      deletedCount++;
    }
    for (let i = 0; i < tmp.length; i++) {
      this.removeTrace(engine, tmp[i]);
    }
    this.sTrace.clear();
    return deletedCount;
  }

  public addSub(id: string, subD: any): void {
    this.sSub.set(id, subD);
  }

  public getSub(id: string): any {
    return this.sSub.get(id);
  }

  public removeSub(engine: BaseEngine, id: string): any {
    let actor: any = false;
    if (this.sSub.has(id)) {
      actor = this.sSub.get(id);
      this.sSub.delete(id);
      engine.removeSub(actor.getUri(), id);
    }
    return actor;
  }

  public cleanupReg(engine: BaseEngine): number {
    const tmp: string[] = [];
    let deletedCount = 0;
    for (const [key] of this.sSub) {
      tmp.push(key);
      deletedCount++;
    }
    for (let i = 0; i < tmp.length; i++) {
      this.removeSub(engine, tmp[i]);
    }
    return deletedCount;
  }

  public setDisconnectPublish(ctx: Context, cmd: RealmCommand): void {
    this.willPublishCtx = ctx;
    this.willPublishCmd = cmd;
  }

  public cleanDisconnectPublish(): void {
    this.willPublishCtx = undefined;
    this.willPublishCmd = undefined;
  }

  public genSessionMsgId(): number {
    return ++this.sessionMsgId;
  }

  public waitForId(id: any, customId: any): void {
    this.publishMap.set(customId, id);
  }

  public fetchWaitId(customId: any): any {
    const result = this.publishMap.get(customId);
    this.publishMap.delete(customId);
    return result;
  }

  public setLastPublishedId(id: string): void {
    this.lastPublishedId = id;
  }

  public getLastPublishedId(): string {
    return this.lastPublishedId;
  }

  public cleanup(): Promise<any> {
    let promise: Promise<any>;
    if (this.realm) {
      if (this.willPublishCmd && this.willPublishCtx) {
        this.realm.cmdPush(this.willPublishCtx, this.willPublishCmd);
      }
      promise = this.realm.leaveSession(this);
    } else {
      promise = Promise.resolve(true);
    }
    this.active = false;
    return promise;
  }

  public setSendFailed(e: Error): void {
    if (!this.firstSendErrorMessageState) {
      this.firstSendErrorMessageState = e.message;
    }
  }

  public hasSendError(): boolean {
    return !!this.firstSendErrorMessageState;
  }

  public firstSendErrorMessage(): string | undefined {
    return this.firstSendErrorMessageState;
  }

  public isActive(): boolean {
    return this.active;
  }

  public getGateProtocol(): string {
    return this.gateProtocol;
  }

  public setGateProtocol(protocolName: string): string {
    return this.gateProtocol = protocolName;
  }

  public getRealmInfo(): any {
    if (this.realm) {
      return this.realm.getRealmInfo();
    } else {
      return {};
    }
  }

  public getRealmName(): string | undefined {
    return this.realmName;
  }
}
