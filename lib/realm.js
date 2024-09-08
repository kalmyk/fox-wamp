'use strict'

const { Qlobber } = require('qlobber')
const { EventEmitter } = require('events')

const { SESSION_JOIN, SESSION_LEAVE, RESULT_EMIT, ON_SUBSCRIBED, ON_UNSUBSCRIBED,
  ON_REGISTERED, ON_UNREGISTERED } = require('./messages')

const { match, intersect, merge, extract, restoreUri } = require('./topic_pattern')
const { errorCodes, RealmError } = require('./realm_error')
const WampApi = require('./wamp/api')
const FoxApi = require('./fox_api')
const tools = require('./tools')

/*
  message fields description

  id     user defined ID
  uri
  qid    server generated id for PUSH/CALL/REG/TRACE
  ack    return acknowledge message for PUSH
  rsp    task response to client (OK, ERR, ACK, EMIT)
  rqt    request to broker
  unr    unregister ID, used in UNREG + UNTRACE
  opt    options
*/

class Actor {
  constructor (ctx, msg) {
    this.ctx = ctx
    this.msg = msg
  }

  getOpt () {
    if (this.msg.opt !== undefined) {
      return Object.assign({}, this.msg.opt)
    } else {
      return {}
    }
  }

  acknowledged () {
    try {
      this.ctx.sendAck(this.msg)
    } catch (e) {
      this.ctx.setSendFailed(e)
    }
  }

  rejectCmd (errorCode, text) {
    try {
      this.ctx.sendError(this.msg, errorCode, text)
    } catch (e) {
      this.ctx.setSendFailed(e)
    }
  }

  getSid () {
    return this.ctx.session.sessionId
  }

  getCustomId () {
    return this.msg.id
  }

  getRealm () {
    // realm is not available when client already disconnected
    return this.ctx.session.realm
  }

  getEngine () {
    let realm = this.ctx.session.realm
    if (!realm) {
      throw new RealmError(this.msg.id,
        'no_realm_found',
        'no_realm_found'
      )
    }
    return realm.engine
  }

  isActive () {
    return this.ctx.isActive()
  }
}

class ActorCall extends Actor {
  constructor (ctx, msg) {
    super(ctx, msg)
    this.engine = ctx.session.realm.engine
  }

  getData () {
    return this.msg.data
  }

  getUri () {
    return this.msg.uri
  }

  isActual () {
    return Boolean(this.ctx.session.realm)
  }

  setRegistration (registration) {
    this.destSID = {}
    this.destSID[registration.getSid()] = true
    this.registration = registration
  }

  getRegistration () {
    return this.registration
  }

  responseArrived (actor) {
    if (actor.msg.rqt !== RESULT_EMIT) {
      this.engine.qYield.doneDefer(actor.getSid(), this.taskId)
    }

    try {
      this.ctx.sendResult({
        id: this.msg.id,
        err: actor.msg.err,
        data: actor.getData(),
        rsp: actor.msg.rqt
      })
    } catch (e) {
      this.ctx.setSendFailed(e)
    }

    const subD = this.getRegistration()
    subD.taskResolved()
    if (subD.isAble()) {
      this.engine.checkTasks(subD)
    }
  }
}

class ActorYield extends Actor {
  getData () {
    return this.msg.data
  }
}

class ActorTrace extends Actor {
  constructor (ctx, msg) {
    super(ctx, msg)
    this.traceStarted = false
    this.delayStack = []
    this.retained = !!msg.opt.retained
    this.retainedState = !!msg.opt.retainedState || this.retained
  }

  filter (event) {
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

  sendEvent (cmd) {
    cmd.id = this.msg.id
    cmd.traceId = this.msg.qid
    if (!this.msg.opt.keepTraceFlag) {
      delete cmd.opt.trace
    }
    try {
      this.ctx.sendEvent(cmd)
    } catch (e) {
      this.ctx.setSendFailed(e)
    }
  }

  filterSendEvent (event) {
    if (this.filter(event)) {
      this.sendEvent(event)
    }
  }

  delayEvent (cmd) {
    this.delayStack.push(cmd)
  }

  flushDelayStack () {
    for (let i = 0; i < this.delayStack.length; i++) {
      this.sendEvent(this.delayStack[i])
    }
    this.delayStack = []
  }

  getUri () {
    return this.msg.uri
  }
}

class ActorReg extends ActorTrace {
  constructor (ctx, msg) {
    super(ctx, msg)
    // tasks per worker unlimited if the value below zero
    this.simultaneousTaskLimit = 1
    this.tasksRequested = 0
  }

  callWorker (taskD) {
    this.taskRequested() // mark worker busy
    taskD.setRegistration(this)
    this.getRealm().engine.qYield.addDefer(taskD, taskD.taskId)

    try {
      this.ctx.sendInvoke({
        id: this.msg.id,
        qid: taskD.taskId,
        uri: taskD.getUri(),
        subId: this.subId,
        data: taskD.getData(),
        opt: taskD.getOpt()
      })
    } catch (e) {
      this.ctx.setSendFailed(e)
    }
  }

  isAble () {
    return (this.simultaneousTaskLimit < 0) || (this.simultaneousTaskLimit - this.tasksRequested) > 0
  }

  setSimultaneousTaskLimit (aLimit) {
    this.simultaneousTaskLimit = aLimit
  }

  taskResolved () {
    this.tasksRequested--
  }

  taskRequested () {
    this.tasksRequested++
  }
}

class ActorPush extends Actor {
  constructor (ctx, msg) {
    super(ctx, msg)
    this.clientNotified = false
    this.eventId = null
  }

  setEventId (eventId) {
    this.eventId = eventId
  }

  getEventId () {
    return this.eventId
  }

  confirm (cmd) {
    if (!this.clientNotified) {
      this.clientNotified = true
      if (this.needAck()) {
        const clone = Object.assign({}, cmd)
        clone.id = this.msg.id
        clone.qid = this.eventId
        delete clone.data
        try {
          this.ctx.sendAck(clone)
        } catch (e) {
          this.ctx.setSendFailed(e)
        }
      }
    }
  }

  getData () {
    return this.msg.data
  }

  getUri () {
    return this.msg.uri
  }

  needAck () {
    return this.msg.ack
  }

  getEvent () {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      data: this.getData(),
      opt: this.getOpt(),
      sid: this.getSid()
    }
  }
}

function getDataValue (data) {
  if (data === null) {
    return null
  }
  if (typeof data === 'object') {
    if ('kv' in data)      return data.kv
    if ('payload' in data) return JSON.parse(data.payload)
    if ('args' in data) {
      if (Array.isArray(data.args) && data.args.length === 0) {
        return data.kwargs
      } else {
        return data
      }
    }
  }
  throw new Error('unknown data `' + JSON.stringify(data) + '`')
}

function compareData (when, value) {
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

function isDataEmpty (data) {
  return !data
}

function isDataFit (when, data) {
  return compareData(when, getDataValue(data))
}

function deepMerge (to, from) {
  for (let n in from) {
    if (typeof to[n] != 'object') {
      to[n] = from[n]
    } else if (typeof from[n] == 'object') {
      to[n] = deepMerge(to[n], from[n])
    }
  }
  return to
}

function deepDataMerge (oldData, newData) {
  if (isDataEmpty(oldData) || isDataEmpty(newData)) {
    return newData
  }
  let ov
  try {
    ov = getDataValue(oldData)
  } catch (e) {
    return newData
  }
  let nv
  try {
    nv = getDataValue(newData)
  } catch (e) {
    return oldData
  }
  return { kv: deepMerge(ov,nv)}
}

function makeDataSerializable (body) {
  return (body && ('payload' in body) ? { p64: body.payload.toString('base64') } : body)
}

function unSerializeData (body) {
  return ('p64' in body ? { payload: Buffer.from(body.p64, 'base64') } : body)
}

class DeferMap {
  constructor () {
    /**
      reqest has been sent to worker/writer, the session is waiting for the YIELD
      CALL
        [deferId] = deferred
    */
    this.defers = new Map()
  }

  addDefer (actor, markId) {
    this.defers.set(markId, actor)
    return markId
  }

  getDefer (sid, markId) {
    const result = this.defers.get(markId)
    if (result && result.destSID.hasOwnProperty(sid)) {
      return result
    } else {
      return undefined
    }
  }

  doneDefer (sid, markId) {
    const found = this.defers.get(markId)
    if (found && found.destSID.hasOwnProperty(sid)) {
      this.defers.delete(markId)
    }
  }
}

class BaseEngine {
  constructor () {
    /**
      Subscribed Workewrs for queues
        [uri][sessionId] => actor
    */
    this.wSub = {}

    /**
      waiting for the apropriate worker (CALL)
        [uri][] = actor
    */
    this.qCall = new Map()
    this.qYield = new DeferMap()

    this.wTrace = new Qlobber() // [uri][subscription]
    this._kvo = [] // key value order
  }

  getRealmName() {
    return this.realmName
  }

  setRealmName (realmName) {
    this.realmName = realmName    
  }

  addKv (uri, kv) {
    this._kvo.push({ uri, kv })
  }

  mkDeferId () {
    return tools.randomId()
  }

  createActorEcho  (ctx, cmd) { return new Actor      (ctx, cmd) }
  createActorReg   (ctx, cmd) { return new ActorReg   (ctx, cmd) }
  createActorCall  (ctx, cmd) { return new ActorCall  (ctx, cmd) }
  createActorYield (ctx, cmd) { return new ActorYield (ctx, cmd) }
  createActorTrace (ctx, cmd) { return new ActorTrace (ctx, cmd) }
  createActorPush  (ctx, cmd) { return new ActorPush  (ctx, cmd) }

  getSubStack (uri) {
    return (
      this.wSub.hasOwnProperty(uri)
        ? this.wSub[uri]
        : {}
    )
  }

  waitForResolver (uri, taskD) {
    if (!this.qCall.has(uri)) {
      this.qCall.set(uri, [])
    }
    this.qCall.get(uri).push(taskD)
  }

  addSub (uri, subD) {
    const strUri = restoreUri(uri)
    if (!this.wSub.hasOwnProperty(strUri)) {
      this.wSub[strUri] = {}
    }
    this.wSub[strUri][subD.subId] = subD
  }

  removeSub (uri, id) {
    const strUri = restoreUri(uri)
    delete this.wSub[strUri][id]

    if (Object.keys(this.wSub[strUri]).length === 0) {
      delete this.wSub[strUri]
    }
  }

  checkTasks (subD) {
    const strUri = restoreUri(subD.getUri())
    if (this.qCall.has(strUri)) {
      let taskD
      const taskList = this.qCall.get(strUri)

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

  getPendingTaskCount () {
    return this.qCall.size
  }

  doCall (taskD) {
    const strUri = restoreUri(taskD.getUri())
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
      throw new RealmError(taskD.msg.id,
        errorCodes.ERROR_NO_SUCH_PROCEDURE,
        'no callee registered for procedure <' + strUri + '>'
      )
    }

    // all workers are bisy, keep the message till to the one of them free
    this.waitForResolver(strUri, taskD)
  }

  makeTraceId () {
    return tools.randomId()
  }

  matchTrace (uri) {
    return this.wTrace.match(restoreUri(uri))
  }

  addTrace (subD) {
    this.wTrace.add(restoreUri(subD.getUri()), subD)
  }

  removeTrace (uri, subscription) {
    this.wTrace.remove(restoreUri(uri), subscription)
  }

  doTrace (actor) {
    this.addTrace(actor)
    actor.acknowledged() // WAMP require to have TRACE ACK before first event

    if (actor.getOpt().after) {
      this.getHistoryAfter(
        actor.getOpt().after,
        actor.getUri(),
        (cmd) => {
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
      this.getKey(
        actor.getUri(),
        (key, data, eventId) => {
          actor.filterSendEvent({
            qid: eventId,
            uri: key,
            data: data,
            opt: { retained: true }
          })
        }
      )
    }
  }

  // By default, a Publisher of an event will not itself receive an event published,
  // even when subscribed to the topic the Publisher is publishing to.
  // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.

  // event 
  //   qid: this.eventId,
  //   sid:
  //   uri:
  //   data:
  //   opt: {exclude_me}

  dispatch (event) {
    let destSID = {}
    const found = this.matchTrace(event.uri)
    for (let i = 0; i < found.length; i++) {
      const subD = found[i]
      if (!(event.opt.exclude_me && event.sid == subD.getSid()) && subD.filter(event)) {
        destSID[subD.getSid()] = true
        if (subD.traceStarted) {
          subD.sendEvent(event)
        } else {
          subD.delayEvent(event)
        }
      }
    }
    return destSID
  }

  arrangeEvent (actor) {
    actor.destSID = this.dispatch(actor.getEvent())
  }

  saveChangeHistory (actor) {
    actor.destSID = this.dispatch(actor.getEvent())
  }

  doPush (actor) {
    this.arrangeEvent(actor)
    if (actor.getOpt().retain) {
      this.updateKvFromActor(actor)
    } else {
      actor.confirm(actor.msg)
    }
  }

  updateKvFromActor (actor) {
    const uri = actor.getUri()
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      const kvr = this._kvo[i]
      if (match(uri, kvr.uri)) {
        kvr.kv.setKeyActor(actor)
        return
      }
    }
    throw new RealmError(actor.msg.id,
      'no_storage_defined',
      'no_storage_defined'
    )
  }

  // cbRow(key, data)
  getKey (uri, cbRow) {
    const done = []
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      const kvr = this._kvo[i]
      // console.log('MATCH++', uri, kvr.uri, extract(uri, kvr.uri))
      if (intersect(uri, kvr.uri)) {
        done.push(kvr.kv.getKey(
          extract(uri, kvr.uri),
          (aKey, data, eventId) => {
            cbRow(merge(aKey, kvr.uri), data, eventId)
          }
        ))
      }
    }
    return Promise.all(done)
  }

  cleanupSession(sessionId) {
    let allKv = []
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      allKv.push(this._kvo[i].kv.eraseSessionData(sessionId))
    }
    return Promise.all(allKv)
  }

  getHistoryAfter (after, uri, cbRow) { return new Promise(() => {}) }
}

class BaseRealm extends EventEmitter {
  constructor (router, engine) {
    super()
    this._wampApi = null
    this._foxApi = null

    this._sessions = new Map() // session by sessionId
    this._router = router
    this.engine = engine
  }

  getRouter () {
    return this._router
  }

  getEngine () {
    return this.engine
  }

  doEcho (ctx, cmd) {
    const a = this.engine.createActorEcho(ctx, cmd)
    a.acknowledged()
  }

  // RPC Management
  doRegRpc (ctx, cmd) {
    const session = ctx.getSession()
    // if (_rpcs.hasOwnProperty(cmd.uri)) {
    //     throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
    // }
    const actor = this.engine.createActorReg(ctx, cmd)
    actor.subId = tools.randomId()
    if (cmd.opt.hasOwnProperty('simultaneousTaskLimit')) {
      actor.setSimultaneousTaskLimit(cmd.opt.simultaneousTaskLimit)
    }
    cmd.qid = actor.subId

    this.engine.addSub(cmd.uri, actor)
    session.addSub(actor.subId, actor)
    this.emit(ON_REGISTERED, actor)

    if (actor.getOpt().reducer /* || actor.getOpt().transformTo */) {
      session.addTrace(cmd.qid, actor)
      this.engine.doTrace(actor)
      this.emit(ON_SUBSCRIBED, actor)
    } else {
      actor.acknowledged()
    }

    return actor.subId
  }

  doUnRegRpc (ctx, cmd) {
    const session = ctx.getSession()
    const registration = session.removeSub(this.engine, cmd.unr)
    if (registration) {
      this.emit(ON_UNREGISTERED, registration)
      delete cmd.data
      try {
        ctx.sendAck(cmd)
      } catch (e) {
        ctx.setSendFailed(e)
      }
      return registration.getUri()
    } else {
      throw new RealmError(cmd.id, errorCodes.ERROR_NO_SUCH_REGISTRATION)
    }
  }

  doCallRpc (ctx, cmd) {
    const actor = this.engine.createActorCall(ctx, cmd)
    actor.taskId = this.engine.mkDeferId()
    this.engine.doCall(actor)
    return actor.taskId
  }

  doYield (ctx, cmd) {
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

  doConfirm (ctx, cmd) {}

  // declare wamp.topic.history.after (uri, arg)
  // last    limit|integer
  // since   timestamp|string  ISO-8601 "2013-12-21T13:43:11:000Z"
  // after   publication|id

  // { match: "exact" }
  // { match: "prefix" }    session.subscribe('com.myapp',
  // { match: "wildcard" }  session.subscribe('com.myapp..update',

  // Topic Management
  doTrace (ctx, cmd) {
    const session = ctx.getSession()
    const subscription = this.engine.createActorTrace(ctx, cmd)
    cmd.qid = this.engine.makeTraceId()

    session.addTrace(cmd.qid, subscription)
    this.engine.doTrace(subscription)
    this.emit(ON_SUBSCRIBED, subscription)

    return cmd.qid
  }

  doUnTrace (ctx, cmd) {
    const session = ctx.getSession()
    const subscription = session.removeTrace(this.engine, cmd.unr)
    if (subscription) {
      this.emit(ON_UNSUBSCRIBED, subscription)
      delete cmd.data
      try {
        ctx.sendAck(cmd)
      } catch (e) {
        ctx.setSendFailed(e)
      }
      return subscription.getUri()
    } else {
      throw new RealmError(cmd.id, 'wamp.error.no_such_subscription')
    }
  }

  doPush (ctx, cmd) {
    const actor = this.engine.createActorPush(ctx, cmd)
    this.engine.doPush(actor)
  }

  getSession (sessionId) {
    return this._sessions.get(sessionId)
  }

  joinSession (session) {
    if (this._sessions.has(session.sessionId)) {
      throw new Error('Session already joined')
    }
    session.setRealm(this)
    this._sessions.set(session.sessionId, session)
    this.emit(SESSION_JOIN, session)
  }

  // return: promise
  leaveSession (session) {
    this.emit(SESSION_LEAVE, session)
    session.cleanupTrace(this.engine)
    session.cleanupReg(this.engine)
    this._sessions.delete(session.sessionId)
    session.setRealm(null)
    return this.engine.cleanupSession(session.sessionId)
  }

  getSessionCount () {
    return this._sessions.size
  }

  getSessionIds () {
    let result = []
    for (let [/* sId */, session] of this._sessions) {
      result.push(session.sessionId)
    }
    return result
  }

  getRealmInfo () {
    return {}
  }

  getSessionInfo (sessionId) {
    return { session: sessionId }
  }

  foxApi () {
    if (!this._foxApi) {
      this._foxApi = new FoxApi(this, this.getRouter().makeSessionId())
      this.joinSession(this._foxApi)
    }
    return this._foxApi
  }

  wampApi () {
    if (!this._wampApi) {
      this._wampApi = new WampApi(this, this.getRouter().makeSessionId())
      this.joinSession(this._wampApi)
    }
    return this._wampApi
  }

  getKey (uri, cbRow) {
    return this.engine.getKey(uri, cbRow)
  }

  runInboundEvent (sessionId, uri, data) {
    return this.engine.doPush(new ActorPushKv(
      uri,
      data,
      { sid: sessionId, retain: true, trace: true }
    ))
  }

  registerKeyValueEngine (uri, kv) {
    kv.setUriPattern(uri)
    kv.setSaveChangeHistory(this.engine.saveChangeHistory.bind(this.engine))
    kv.setRunInboundEvent(this.runInboundEvent.bind(this))
    this.engine.addKv(uri, kv)
  }
}

class ActorPushKv {
  constructor (uri, data, opt) {
    this.uri = uri
    this.data = data
    this.opt = opt
    this.eventId = null
  }

  getOpt () {
    return Object.assign({}, this.opt)
  }

  getUri () {
    return this.uri
  }

  getSid() {
    return this.opt.sid
  }

  getData () {
    return this.data
  }

  setEventId (eventId) {
    this.eventId = eventId
  }

  getEventId () {
    return this.eventId
  }

  getEvent () {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      data: this.getData(),
      opt: this.getOpt(),
      sid: this.getSid()
    }
  }

  confirm () {}
}

class KeyValueStorageAbstract {
  constructor () {
    this.uriPattern = '#'
  }

  setUriPattern (uriPattern) {
    this.uriPattern = uriPattern
  }

  setSaveChangeHistory (saveChangeHistory) {
    this.saveChangeHistory = saveChangeHistory
  }

  setRunInboundEvent (runInboundEvent) {
    this.runInboundEvent = runInboundEvent
  }

  getUriPattern () {
    return this.uriPattern
  }

  getStrUri (actor) {
    return restoreUri(extract(actor.getUri(), this.getUriPattern()))
  }

  // ----- methods that must be defined in descendants
  // Promise:getKey (uri, cbRow) ::cbRow:: aKey, data, eventId
  // eraseSessionData (sessionId)
}

exports.Actor = Actor
exports.ActorReg = ActorReg
exports.ActorCall = ActorCall
exports.ActorTrace = ActorTrace
exports.ActorPush = ActorPush

exports.isDataEmpty = isDataEmpty
exports.isDataFit = isDataFit
exports.getDataValue = getDataValue
exports.deepMerge = deepMerge
exports.deepDataMerge = deepDataMerge
exports.makeDataSerializable = makeDataSerializable
exports.unSerializeData = unSerializeData

exports.DeferMap = DeferMap
exports.BaseEngine = BaseEngine
exports.BaseRealm = BaseRealm
exports.ActorPushKv = ActorPushKv
exports.KeyValueStorageAbstract = KeyValueStorageAbstract
