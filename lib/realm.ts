// @ts-ignore
import { Qlobber } from 'qlobber'
import { EventEmitter } from 'events'

import { SESSION_JOIN, SESSION_LEAVE, RESULT_EMIT, ON_SUBSCRIBED, ON_UNSUBSCRIBED,
  ON_REGISTERED, ON_UNREGISTERED } from './messages'

import { match, intersect, merge, extract, restoreUri } from './topic_pattern'
import { getBodyValue } from './base_gate'
import { errorCodes, RealmError } from './realm_error'
import { HyperApiContext, HyperClient } from './hyper/client'
import { WampApi } from './wamp/api'
import * as tools from './tools'
import { Context } from './context'
import { Router } from './router'
import { Session } from './session'

export class Actor {
  ctx: Context
  msg: any

  constructor(ctx: Context, msg: any) {
    this.ctx = ctx
    this.msg = msg
  }

  getOpt(): any {
    if (this.msg.opt !== undefined) {
      return Object.assign({}, this.msg.opt)
    } else {
      return {}
    }
  }

  rejectCmd(errorCode: string, text?: string): void {
    try {
      this.ctx.sendError!(this.msg, errorCode, text)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  getSid(): string {
    return this.ctx.session.sessionId
  }

  getCustomId(): any {
    return this.msg.id
  }

  getSessionRealm(): BaseRealm | null {
    return this.ctx.session.realm || null;
  }

  getEngine(): BaseEngine {
    let realm = this.ctx.session.realm;
    if (!realm) {
      throw new RealmError(this.msg.id,
        'no_realm_found',
        'no_realm_found'
      );
    }
    return realm.engine;
  }

  isActive(): boolean {
    return this.ctx.isActive();
  }
}

export class ActorEcho extends Actor {
  okey(): void {
    try {
      this.ctx.sendOkey!(this.msg)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }
}

export class ActorCall extends Actor {
  engine: BaseEngine
  destSID: Record<string, boolean>
  registration!: ActorReg
  taskId: string | number

  constructor(ctx: Context, msg: any) {
    super(ctx, msg)
    this.engine = ctx.session.realm!.engine
    this.destSID = {}
    this.taskId = ''
  }

  getHeaders(): any {
    return this.msg.hdr
  }

  getData(): any {
    return this.msg.data
  }

  getUri(): string {
    return this.msg.uri
  }

  isActual(): boolean {
    return Boolean(this.ctx.session.realm)
  }

  setRegistration(registration: ActorReg): void {
    this.destSID = {}
    this.destSID[registration.getSid()] = true
    this.registration = registration
  }

  getRegistration(): ActorReg {
    return this.registration
  }

  responseArrived(actor: ActorYield): void {
    if (actor.msg.rqt !== RESULT_EMIT) {
      this.engine.qYield.doneDefer(actor.getSid(), this.taskId)
    }

    try {
      this.ctx.sendResult!({
        id: this.msg.id,
        err: actor.msg.err,
        hdr: actor.getHeaders(),
        data: actor.getData(),
        rsp: actor.msg.rqt
      })
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }

    const subD = this.getRegistration()
    subD.taskResolved()
    if (subD.isAble()) {
      this.engine.checkTasks(subD)
    }
  }
}

export class ActorYield extends Actor {
  getHeaders(): any {
    return this.msg.hdr
  }

  getData(): any {
    return this.msg.data
  }
}

export class ActorTrace extends Actor {
  traceStarted: boolean
  delayStack: any[]
  retained: boolean
  retainedState: boolean
  subscriptionActive: boolean

  constructor(ctx: Context, msg: any) {
    super(ctx, msg)
    const opt = msg.opt || {}
    this.traceStarted = false
    this.delayStack = []
    this.retained = !!opt.retained
    this.retainedState = !!opt.retainedState || this.retained
    this.subscriptionActive = true
  }

  filter(event: any): boolean {
    if (this.retained && !event.opt.retained && !event.opt.delta) {
      return false
    }
    if (!this.retained && event.opt.delta) {
      return false
    }
    if (this.msg.opt.filter) {
      return isDataFit(this.msg.opt.filter, event.data)
    }
    return true
  }

  sendEvent(cmd: any): void {
    cmd.id = this.msg.id
    cmd.traceId = this.msg.qid
    if (!this.msg.opt.keepTraceFlag) {
      delete cmd.opt.trace
    }
    try {
      this.ctx.sendEvent!(cmd)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  filterSendEvent(event: any): void {
    if (this.subscriptionActive && this.filter(event)) {
      this.sendEvent(event)
    }
  }

  delayEvent(cmd: any): void {
    this.delayStack.push(cmd)
  }

  flushDelayStack(): void {
    if (!this.subscriptionActive) {
      this.delayStack = []
      return
    }
    for (let i = 0; i < this.delayStack.length; i++) {
      this.sendEvent(this.delayStack[i])
    }
    this.delayStack = []
  }

  getUri(): string {
    return this.msg.uri
  }

  atSubscribe(): void {
    try {
      this.ctx.sendSubscribed!(this.msg)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  atEndSubscribe(): void {
    try {
      this.ctx.sendEndSubscribe!(this.msg)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  closeSubscription(): void {
    this.subscriptionActive = false
    this.delayStack = []
  }
}

export class ActorReg extends ActorTrace {
  simultaneousTaskLimit: number
  tasksRequested: number
  subId: string | number

  constructor(ctx: Context, msg: any) {
    super(ctx, msg)
    this.simultaneousTaskLimit = 1
    this.tasksRequested = 0
    this.subId = ''
  }

  callWorker(taskD: ActorCall): void {
    this.taskRequested()
    taskD.setRegistration(this)
    this.getSessionRealm()!.engine.qYield.addDefer(taskD, taskD.taskId)

    try {
      (this.ctx as any).sendInvoke({
        id: this.msg.id,
        qid: taskD.taskId,
        uri: taskD.getUri(),
        subId: this.subId,
        hdr: taskD.getHeaders(),
        data: taskD.getData(),
        opt: taskD.getOpt()
      })
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  isAble(): boolean {
    return (this.simultaneousTaskLimit < 0) || (this.simultaneousTaskLimit - this.tasksRequested) > 0
  }

  setSimultaneousTaskLimit(aLimit: number): void {
    this.simultaneousTaskLimit = aLimit
  }

  taskResolved(): void {
    this.tasksRequested--
  }

  taskRequested(): void {
    this.tasksRequested++
  }

  getTasksRequestedCount(): number {
    return this.tasksRequested
  }

  atRegister(): void {
    try {
      this.ctx.sendRegistered!(this.msg)
    } catch (e) {
      this.ctx.setSendFailed(e as Error)
      throw e
    }
  }

  atUnregister(): void {
  }
}

export class ActorPush extends Actor {
  clientNotified: boolean
  eventId: string | null

  constructor(ctx: Context, msg: any) {
    super(ctx, msg)
    this.clientNotified = false
    this.eventId = null
  }

  setEventId(eventId: string | null): void {
    this.eventId = eventId
  }

  getEventId(): string | null {
    return this.eventId
  }

  confirm(cmd: any): void {
    if (!this.clientNotified) {
      this.clientNotified = true
      if (this.needAck()) {
        try {
          this.ctx.sendPublished!({id: this.msg.id, qid: this.eventId})
        } catch (e) {
          this.ctx.setSendFailed(e as Error)
          throw e
        }
      }
    }
  }

  getHeaders(): any {
    return this.msg.hdr
  }

  getData(): any {
    return this.msg.data
  }

  getUri(): string[] {
    return this.msg.uri
  }

  needAck(): boolean {
    return this.msg.ack
  }

  getEvent(): any {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      hdr: this.getHeaders(),
      data: this.getData(),
      opt: this.getOpt(),
      sid: this.getSid()
    }
  }
}

function compareData(when: any, value: any): boolean {
  if (when === null && value === null) {
    return true
  }

  if (when !== null && value !== null) {
    if (typeof when === 'object') {
      for (const name in when) {
        if (!(name in value) || !compareData(when[name], value[name])) {
          return false
        }
      }
      return true
    }
    return when == value
  }
  return false
}

export function isBodyValueEmpty(bodyValue: any): boolean {
  return !bodyValue
}

export function isDataEmpty(data: any): boolean {
  return isBodyValueEmpty(getBodyValue(data))
}

export function isDataFit(when: any, data: any): boolean {
  return compareData(when, getBodyValue(data))
}

export function deepMerge(to: any, from: any): any {
  const result = Object.assign({}, to)
  for (let n in from) {
    if (typeof result[n] !== 'object') {
      result[n] = from[n]
    } else if (typeof from[n] === 'object') {
      result[n] = deepMerge(result[n], from[n])
    }
  }
  return result
}

export function deepDataMerge(oldData: any, newData: any): any {
  let ov: any;
  try {
    ov = getBodyValue(oldData)
  } catch (e) {
    return newData
  }
  let nv: any;
  try {
    nv = getBodyValue(newData)
  } catch (e) {
    return oldData
  }
  if (isBodyValueEmpty(ov) || isBodyValueEmpty(nv)) {
    return newData
  }
  return { kv: deepMerge(ov, nv) }
}

export function makeDataSerializable(body: any): any {
  return (body && ('payload' in body) ? { p64: body.payload.toString('base64') } : body)
}

export function unSerializeData(body: any): any {
  return ('p64' in body ? { payload: Buffer.from(body.p64, 'base64') } : body)
}

export class DeferMap {
  defers: Map<string | number, ActorCall>

  constructor() {
    this.defers = new Map()
  }

  addDefer(actor: ActorCall, markId: string | number): string | number {
    this.defers.set(markId, actor)
    return markId
  }

  getDefer(sid: string, markId: string | number): ActorCall | undefined {
    const result = this.defers.get(markId)
    if (result && result.destSID.hasOwnProperty(sid)) {
      return result
    } else {
      return undefined
    }
  }

  doneDefer(sid: string, markId: string | number): void {
    const found = this.defers.get(markId)
    if (found && found.destSID.hasOwnProperty(sid)) {
      this.defers.delete(markId)
    }
  }
}

type RetainedEventWaiter = {
  eventId: string
  actor: ActorTrace
  resolve: (reached: boolean) => void
  timeout: ReturnType<typeof setTimeout>
}

export function isValidEventIdMarker(eventId: any): boolean {
  return typeof eventId === 'string' && eventId.length > 0
}

export class BaseEngine {
  wSub: Record<string, Record<string | number, ActorReg>>
  qCall: Map<string, ActorCall[]>
  qYield: DeferMap
  wTrace: any
  _kvList: { uri: string[], kv: KeyValueStorageAbstract }[]
  realmName?: string
  currentRetainedEventId: string | null
  pendingRetainedEventWaiters: RetainedEventWaiter[]
  retainedEventWaitTimeoutMs: number
  supportsRetainedEventSync: boolean

  constructor() {
    this.wSub = {}
    this.qCall = new Map()
    this.qYield = new DeferMap()
    this.wTrace = new Qlobber()
    this._kvList = []
    this.currentRetainedEventId = null
    this.pendingRetainedEventWaiters = []
    this.retainedEventWaitTimeoutMs = 30000
    this.supportsRetainedEventSync = true
  }

  getRealmName(): string {
    return this.realmName!
  }

  async launchEngine(realmName: string): Promise<void> {
    this.realmName = realmName
  }

  addKv(uri: string[], kv: KeyValueStorageAbstract): void {
    this._kvList.push({ uri, kv })
  }

  mkDeferId(): string | number {
    return tools.randomId()
  }

  createActorEcho(ctx: Context, cmd: any): ActorEcho { return new ActorEcho(ctx, cmd) }
  createActorReg(ctx: Context, cmd: any): ActorReg { return new ActorReg(ctx, cmd) }
  createActorCall(ctx: Context, cmd: any): ActorCall { return new ActorCall(ctx, cmd) }
  createActorYield(ctx: Context, cmd: any): ActorYield { return new ActorYield(ctx, cmd) }
  createActorTrace(ctx: Context, cmd: any): ActorTrace { return new ActorTrace(ctx, cmd) }
  createActorPush(ctx: Context, cmd: any): ActorPush { return new ActorPush(ctx, cmd) }

  getSubStack(uri: string): Record<string | number, ActorReg> {
    return (
      this.wSub.hasOwnProperty(uri)
        ? this.wSub[uri]
        : {}
    )
  }

  waitForResolver(uri: string, taskD: ActorCall): void {
    if (!this.qCall.has(uri)) {
      this.qCall.set(uri, [])
    }
    this.qCall.get(uri)!.push(taskD)
  }

  addSub(uri: string, subD: ActorReg): void {
    const strUri = restoreUri(uri as any)
    if (!this.wSub.hasOwnProperty(strUri)) {
      this.wSub[strUri] = {}
    }
    this.wSub[strUri][subD.subId] = subD
  }

  removeSub(uri: string, id: string | number): void {
    const strUri = restoreUri(uri as any)
    if (this.wSub[strUri]) {
      delete this.wSub[strUri][id]
      if (Object.keys(this.wSub[strUri]).length === 0) {
        delete this.wSub[strUri]
      }
    }
  }

  checkTasks(subD: ActorReg): boolean {
    const strUri = restoreUri(subD.getUri() as any)
    if (this.qCall.has(strUri)) {
      let taskD: ActorCall | undefined
      const taskList = this.qCall.get(strUri)!

      do {
        taskD = taskList.shift()

        if (taskList.length === 0) {
          this.qCall.delete(strUri)
        }
        if (taskD && taskD.isActual()) {
          subD.callWorker(taskD)
          return true
        }
      }
      while (taskD)
    }
    return false
  }

  getPendingTaskCount(): number {
    return this.qCall.size
  }

  doCall(taskD: ActorCall): null | undefined {
    const strUri = restoreUri(taskD.getUri() as any)
    const queue = this.getSubStack(strUri)
    let subExists = false
    for (let index in queue) {
      const subD = queue[index]
      subExists = true
      if (subD.isAble()) {
        subD.callWorker(taskD)
        return null
      }
    }

    if (!subExists) {
      throw new RealmError(
        taskD.msg.id,
        errorCodes.ERROR_NO_SUCH_PROCEDURE,
        'no callee registered for procedure <' + strUri + '>'
      )
    }

    this.waitForResolver(strUri, taskD)
    return undefined
  }

  makeTraceId(): string | number {
    return tools.randomId()
  }

  matchTrace(uri: string): ActorTrace[] {
    return this.wTrace.match(restoreUri(uri as any))
  }

  addTrace(subD: ActorTrace): void {
    this.wTrace.add(restoreUri(subD.getUri() as any), subD)
  }

  removeTrace(uri: string, subscription: ActorTrace): void {
    subscription.closeSubscription()
    this.cancelRetainedEventWaiters(subscription)
    this.wTrace.remove(restoreUri(uri as any), subscription)
  }

  isRetainedEventReached(eventId: string): boolean {
    if (!this.currentRetainedEventId) {
      return false
    }
    return this.compareRetainedEventIds(this.currentRetainedEventId, eventId) >= 0
  }

  compareRetainedEventIds(left: string, right: string): number {
    if (/^\d+$/.test(left) && /^\d+$/.test(right)) {
      const leftNum = BigInt(left)
      const rightNum = BigInt(right)
      if (leftNum === rightNum) {
        return 0
      }
      return leftNum > rightNum ? 1 : -1
    }
    if (left === right) {
      return 0
    }
    return left > right ? 1 : -1
  }

  waitForRetainedEventId(eventId: string, actor: ActorTrace): Promise<boolean> {
    if (this.isRetainedEventReached(eventId)) {
      return Promise.resolve(true)
    }
    return new Promise(resolve => {
      const waiter: RetainedEventWaiter = {
        eventId,
        actor,
        resolve,
        timeout: setTimeout(() => {
          this.removeRetainedEventWaiter(waiter)
          resolve(false)
        }, this.retainedEventWaitTimeoutMs)
      }
      this.pendingRetainedEventWaiters.push(waiter)
    })
  }

  removeRetainedEventWaiter(waiter: RetainedEventWaiter): void {
    const index = this.pendingRetainedEventWaiters.indexOf(waiter)
    if (index >= 0) {
      this.pendingRetainedEventWaiters.splice(index, 1)
    }
    clearTimeout(waiter.timeout)
  }

  cancelRetainedEventWaiters(actor: ActorTrace): void {
    const waiters = this.pendingRetainedEventWaiters.filter(waiter => waiter.actor === actor)
    for (let i = 0; i < waiters.length; i++) {
      this.removeRetainedEventWaiter(waiters[i])
      waiters[i].resolve(false)
    }
  }

  resolveRetainedEventWaiters(eventId: string): void {
    this.currentRetainedEventId = eventId
    const waiters = this.pendingRetainedEventWaiters.filter(waiter => {
      return this.compareRetainedEventIds(eventId, waiter.eventId) >= 0
    })
    for (let i = 0; i < waiters.length; i++) {
      this.removeRetainedEventWaiter(waiters[i])
      waiters[i].resolve(true)
    }
  }

  replayRetainedState(actor: ActorTrace): Promise<any[]> {
    return this.getKey(
      actor.getUri() as any,
      (key: any, data: any, eventId: any) => {
        actor.filterSendEvent({
          qid: eventId,
          uri: key,
          data: data,
          opt: { retained: true }
        })
      }
    )
  }

  doTrace(actor: ActorTrace): void {
    this.addTrace(actor)
    actor.atSubscribe()

    const after = actor.getOpt().after

    if (after) {
      this.getHistoryAfter(
        after,
        actor.getUri() as any,
        (cmd: any) => {
          actor.filterSendEvent({
            data: cmd.data,
            uri: cmd.uri,
            qid: cmd.qid,
            opt: {}
          })
        }
      ).then(() => {
        actor.traceStarted = true
        actor.flushDelayStack()
      })
    } else {
      actor.traceStarted = true
      actor.flushDelayStack()
    }

    if (actor.retainedState) {
      if (after) {
        this.waitForRetainedEventId(after, actor).then(reached => {
          if (reached && actor.isActive() && actor.subscriptionActive) {
            this.replayRetainedState(actor)
          }
        })
      } else {
        this.replayRetainedState(actor)
      }
    }
  }

  disperseToSubs(event: any): void {
    for (const subD of this.matchTrace(event.uri)) {
      if (!(event.opt.exclude_me && event.sid == subD.getSid())
        && subD.filter(event)
      ) {
        if (subD.traceStarted) {
          subD.sendEvent(event)
        } else {
          subD.delayEvent(event)
        }
      }
    }
  }

  saveInboundHistory(actor: ActorPush): void {
  }

  saveChangeHistory(actor: ActorPush): void {
    this.disperseToSubs(actor.getEvent())
  }

  doPush(actor: ActorPush): void {
    this.saveInboundHistory(actor)
    this.disperseToSubs(actor.getEvent())
    if (actor.getOpt().retain) {
      this.updateKvFromActor(actor).then(() => {
        const eventId = actor.getEventId()
        if (eventId) {
          this.resolveRetainedEventWaiters(eventId)
        }
      })
    } else {
      actor.confirm(actor.msg)
    }
  }

  updateKvFromActor(actor: ActorPush): Promise<any> {
    const uri = actor.getUri()
    for (let i = this._kvList.length - 1; i >= 0; i--) {
      const curKv = this._kvList[i]
      if (match(uri, curKv.uri)) {
        return curKv.kv.setKeyActor(actor)
      }
    }
    throw new RealmError(actor.msg.id,
      'no_storage_defined',
      'no_storage_defined'
    )
  }

  getKey(uri: string[], cbRow: (key: string[], data: any, eventId: any) => void): Promise<any> {
    const done: Promise<any>[] = []
    for (let i = this._kvList.length - 1; i >= 0; i--) {
      const curKv = this._kvList[i]
      if (intersect(uri, curKv.uri)) {
        done.push(curKv.kv.getKey(
          extract(uri, curKv.uri),
          (aKey: string[], data: any, eventId: any) => {
            cbRow(merge(aKey, curKv.uri), data, eventId)
          }
        ))
      }
    }
    return Promise.all(done)
  }

  cleanupSession(sessionId: string): Promise<any[]> {
    const waiters = this.pendingRetainedEventWaiters.filter(waiter => waiter.actor.getSid() === sessionId)
    for (let i = 0; i < waiters.length; i++) {
      this.removeRetainedEventWaiter(waiters[i])
      waiters[i].resolve(false)
    }
    let allKv: Promise<any>[] = []
    for (let i = this._kvList.length - 1; i >= 0; i--) {
      allKv.push(this._kvList[i].kv.eraseSessionData(sessionId))
    }
    return Promise.all(allKv)
  }

  getHistoryAfter(after: any, uri: string[], cbRow: (cmd: any) => void): Promise<void> {
    return new Promise((resolve) => { resolve(); })
  }
}

export class BaseRealm extends EventEmitter {
  _wampApi!: WampApi
  _hyperApi!: HyperClient
  _sessions: Map<string, Session>
  _router: Router
  _dict!: TableDictionary
  engine: BaseEngine

  constructor(router: Router, engine: BaseEngine) {
    super()
    this._sessions = new Map()
    this._router = router
    this.engine = engine
  }

  getRouter(): Router {
    return this._router
  }

  getEngine(): BaseEngine {
    return this.engine
  }

  setDict(dict: TableDictionary): void {
    this._dict = dict
  }

  cmdEcho(ctx: Context, cmd: any): void {
    const a = this.engine.createActorEcho(ctx, cmd)
    a.okey()
  }

  cmdRegRpc(ctx: Context, cmd: any): string | number {
    const session = ctx.getSession()
    const actor = this.engine.createActorReg(ctx, cmd)
    actor.subId = tools.randomId().toString()
    if (cmd.opt.hasOwnProperty('simultaneousTaskLimit')) {
      actor.setSimultaneousTaskLimit(cmd.opt.simultaneousTaskLimit)
    }
    cmd.qid = actor.subId

    this.engine.addSub(cmd.uri, actor)
    session.addSub(actor.subId, actor)
    this.emit(ON_REGISTERED, actor)

    if (actor.getOpt().reducer) {
      session.addTrace(cmd.qid, actor)
      this.engine.doTrace(actor)
      this.emit(ON_SUBSCRIBED, actor)
    } else {
      actor.atRegister()
    }

    return actor.subId
  }

  cmdUnRegRpc(ctx: Context, cmd: any): string {
    const session = ctx.getSession()
    const registration = session.removeSub(this.engine, cmd.unr)
    if (registration) {
      this.emit(ON_UNREGISTERED, registration)
      delete cmd.data
      registration.atUnregister()
      try {
        ctx.sendUnregistered!(cmd)
      } catch (e) {
        ctx.setSendFailed(e as Error)
        throw e
      }
      return registration.getUri()
    } else {
      throw new RealmError(cmd.id, errorCodes.ERROR_NO_SUCH_REGISTRATION)
    }
  }

  cmdCallRpc(ctx: Context, cmd: any): string | number {
    if (this._dict) {
      this._dict.validateStruct(cmd.uri, cmd.data)
    }
    const actor = this.engine.createActorCall(ctx, cmd)
    actor.taskId = this.engine.mkDeferId()
    this.engine.doCall(actor)
    return actor.taskId
  }

  cmdYield(ctx: Context, cmd: any): void {
    const session = ctx.getSession()
    const invocation = this.engine.qYield.getDefer(session.sessionId, cmd.qid)
    if (invocation) {
      invocation.responseArrived(this.engine.createActorYield(ctx, cmd))
    } else {
      throw new RealmError(cmd.qid,
        errorCodes.ERROR_DEFER_NOT_FOUND,
        'The defer requested not found'
      )
    }
  }

  cmdConfirm(ctx: Context, cmd: any): void {}

  cmdTrace(ctx: Context, cmd: any): string | number {
    cmd.opt = cmd.opt || {}
    const retainedState = !!cmd.opt.retainedState || !!cmd.opt.retained
    if ('after' in cmd.opt && !isValidEventIdMarker(cmd.opt.after)) {
      throw new RealmError(cmd.id,
        errorCodes.ERROR_INVALID_ARGUMENT,
        'after must be a non-empty string'
      )
    }
    if (retainedState && 'after' in cmd.opt && !this.engine.supportsRetainedEventSync) {
      throw new RealmError(cmd.id,
        errorCodes.ERROR_OPTION_NOT_SUPPORTED,
        'synchronized retained sync is not supported by this engine'
      )
    }
    const session = ctx.getSession()
    const subscription = this.engine.createActorTrace(ctx, cmd)
    cmd.qid = this.engine.makeTraceId()

    session.addTrace(cmd.qid, subscription)
    this.engine.doTrace(subscription)
    this.emit(ON_SUBSCRIBED, subscription)

    return cmd.qid
  }

  cmdUnTrace(ctx: Context, cmd: any): string {
    const session = ctx.getSession()
    const subscription = session.removeTrace(this.engine, cmd.unr)
    if (subscription) {
      this.emit(ON_UNSUBSCRIBED, subscription)
      delete cmd.data
      try {
        subscription.atEndSubscribe()
        ctx.sendUnsubscribed!(cmd)
      } catch (e) {
        ctx.setSendFailed(e as Error)
        throw e;
      }
      return subscription.getUri()
    } else {
      throw new RealmError(cmd.id, 'wamp.error.no_such_subscription')
    }
  }

  cmdPush(ctx: Context, cmd: any): void {
    if (this._dict) {
      this._dict.validateStruct(cmd.uri, cmd.data)
    }
    const actor = this.engine.createActorPush(ctx, cmd)
    this.engine.doPush(actor)
  }

  getSession(sessionId: string): Session | undefined {
    return this._sessions.get(sessionId)
  }

  joinSession(session: Session): void {
    if (this._sessions.has(session.sessionId)) {
      throw new Error('Session already joined')
    }
    session.setRealm(this)
    this._sessions.set(session.sessionId, session)
    this.emit(SESSION_JOIN, session)
  }

  leaveSession(session: Session): Promise<any[]> {
    this.emit(SESSION_LEAVE, session)
    session.cleanupTrace(this.engine)
    session.cleanupReg(this.engine)
    this._sessions.delete(session.sessionId)
    session.setRealm(null as any)
    return this.engine.cleanupSession(session.sessionId)
  }

  getSessionCount(): number {
    return this._sessions.size
  }

  getSessionIds(): string[] {
    let result: string[] = []
    for (let [sId, session] of this._sessions) {
      result.push(session.sessionId)
    }
    return result
  }

  getRealmInfo(): any {
    return {}
  }

  getSessionInfo(sessionId: string): any {
    return { session: sessionId }
  }

  buildApi(): HyperClient {
    const session = this.getRouter().createSession()
    this.joinSession(session)
    session.setGateProtocol('internal.hyper.api')
    
    const api = new HyperClient(this, new HyperApiContext(this.getRouter(), session, this));
    api.setSession(session);
    return api
  }

  api(): HyperClient {
    if (!this._hyperApi) {
      this._hyperApi = this.buildApi()
    }
    return this._hyperApi
  }

  wampApi(): WampApi {
    if (!this._wampApi) {
      this._wampApi = new WampApi(this, this.getRouter().makeSessionId())
      this.joinSession(this._wampApi as any)
    }
    return this._wampApi
  }

  getKey(uri: string[], cbRow: (key: string[], data: any, eventId: any) => void): Promise<void> {
    return this.engine.getKey(uri, cbRow);
  }

  runInboundEvent(sessionId: string, uri: string[], bodyValue: any): void {
    return this.engine.doPush(new ActorPushKv(
      uri as any,
      { kv: bodyValue },
      { sid: sessionId, retain: true, trace: true }
    ) as any)
  }

  registerKeyValueEngine(uriPattern: string[], kv: KeyValueStorageAbstract): void {
    kv.setUriPattern(uriPattern)
    kv.setSaveChangeHistory(this.engine.saveChangeHistory.bind(this.engine))
    kv.setRunInboundEvent(this.runInboundEvent.bind(this) as any)
    this.engine.addKv(uriPattern, kv)
  }
}

export class ActorPushKv {
  uri: string
  data: any
  opt: any
  eventId: string | null

  constructor(uri: string, data: any, opt: any) {
    this.uri = uri
    this.data = data
    this.opt = opt
    this.eventId = null
  }

  getOpt(): any {
    return Object.assign({}, this.opt)
  }

  getUri(): string {
    return this.uri
  }

  getSid(): string {
    return this.opt.sid
  }

  getData(): any {
    return this.data
  }

  setEventId(eventId: string | null): void {
    this.eventId = eventId
  }

  getEventId(): string | null {
    return this.eventId
  }

  getEvent(): any {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      data: this.getData(),
      opt: this.getOpt(),
      sid: this.getSid()
    }
  }

  confirm(): void {}
}

export abstract class KeyValueStorageAbstract {
  uriPattern: string[]
  saveChangeHistory!: (actor: ActorPush) => void
  runInboundEvent!: (sessionId: string, uri: string[], bodyValue: any) => void

  constructor() {
    this.uriPattern = ['#']
  }

  setUriPattern(uriPattern: string[]): void {
    this.uriPattern = uriPattern
  }

  setSaveChangeHistory(saveChangeHistory: (actor: ActorPush) => void): void {
    this.saveChangeHistory = saveChangeHistory
  }

  setRunInboundEvent(runInboundEvent: (sessionId: string, uri: string[], bodyValue: any) => void): void {
    this.runInboundEvent = runInboundEvent
  }

  getUriPattern(): string[] {
    return this.uriPattern
  }

  getStrUri(actor: Actor): string {
    return restoreUri(extract((actor as any).getUri() as any, this.getUriPattern()) as any)
  }

  abstract setKeyActor(actor: ActorPush): Promise<any>
  abstract getKey(uri: string[], cbRow: (aKey: string[], data: any, eventId: any) => void): Promise<void>
  abstract eraseSessionData(sessionId: string): Promise<void>
}

export class TableDictionary {
  _tables: Map<string, any>

  constructor() {
    this._tables = new Map()
  }
    
  getTableDef(tableName: string): any {
    return this._tables.get(tableName)
  }

  validateStruct(uri: string, data: any): void {
    const tableName = restoreUri(uri as any)
    if (this._tables.has(tableName)) {
      this.getTableDef(tableName).validateStruct(getBodyValue(data))
    }
  }
}
