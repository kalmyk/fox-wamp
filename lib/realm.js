'use strict'

const Qlobber = require('qlobber').Qlobber
const EventEmitter = require('events').EventEmitter

const { SESSION_JOIN, SESSION_LEAVE, RESULT_EMIT, ON_SUBSCRIBED, ON_UNSUBSCRIBED,
  ON_REGISTERED, ON_UNREGISTERED } = require('./messages')

const { match, intersect, merge, extract, restoreUri } = require('./topic_pattern')
const errorCodes = require('./realm_error').errorCodes
const RealmError = require('./realm_error').RealmError
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
    return this.ctx.acknowledged(this.msg)
  }

  reject (errorCode, text) {
    return this.ctx.sendError(this.msg, errorCode, text)
  }

  getSid () {
    return this.ctx.session.sessionId
  }

  getRealm () {
    // realm is not available when client already disconnected
    return this.ctx.session.realm
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

    this.ctx.sendResult({
      id: this.msg.id,
      err: actor.msg.err,
      data: actor.getData(),
      rsp: actor.msg.rqt
    })

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
  }

  filter (event) {
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
    this.ctx.sendEvent(cmd)
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

    this.ctx.sendInvoke({
      id: this.msg.id,
      qid: taskD.taskId,
      uri: taskD.getUri(),
      subId: this.subId,
      data: taskD.getData(),
      opt: taskD.getOpt()
    })
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

  confirm (cmd) {
    if (!this.clientNotified) {
      this.clientNotified = true
      if (this.needAck()) {
        let clone = Object.assign({}, cmd)
        clone.id = this.msg.id
        clone.qid = this.eventId
        this.ctx.acknowledged(clone)
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
      opt: this.getOpt()
    }
  }
}

function getValue (data) {
  if (data === null) {
    return null
  }
  if (typeof data === 'object') {
    if ('kv' in data) return data.kv
    if ('payload' in data) return JSON.parse(data.payload)
    if ('args' in data) {
      /// && Array.isArray(data.args)
      return data.kwargs
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

function isDataFit (when, data) {
  return compareData(when, getValue(data))
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
  }

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
      let taskList = this.qCall.get(strUri)

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
      this.getHistoryAfter(actor.getOpt().after, actor.getUri(), (cmd) => {
        actor.sendEvent({
          data: cmd.data,
          uri: cmd.uri,
          qid: cmd.qid,
          opt: { retained: true }
        })
      }).then(() => {
        actor.traceStarted = true
        actor.flushDelayStack()
      })
    } else {
      actor.traceStarted = true
      actor.flushDelayStack()
    }
  }

  actorPush (subD, event) {
    if (subD.traceStarted) {
      subD.sendEvent(event)
    } else {
      subD.delayEvent(event)
    }
  }

  actorConfirm (actor, cmd) {
    let clone = Object.assign({}, cmd)
    delete clone.data
    actor.confirm(clone)
  }

  // By default, a Publisher of an event will not itself receive an event published,
  // even when subscribed to the topic the Publisher is publishing to.
  // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.
  dispatch (event, excludeSid) {
    let destSID = {}
    const found = this.matchTrace(event.uri)
    for (let i = 0; i < found.length; i++) {
      const subD = found[i]
      if (excludeSid !== subD.getSid() && subD.filter(event)) {
        destSID[subD.getSid()] = true
        this.actorPush(subD, event)
      }
    }
    return destSID
  }

  doPush (actor) {
    const excludeSid = actor.getOpt().exclude_me ? actor.getSid() : 0
    actor.destSID = this.dispatch(actor.getEvent(), excludeSid)
    this.actorConfirm(actor, actor.msg)
  }

  getHistoryAfter (after, uri, cbRow) { return new Promise(() => {}) }
}

class BaseRealm extends EventEmitter {
  constructor (router, realmName, engine) {
    super()
    this._wampApi = null
    this._foxApi = null

    this._sessions = new Map() // session by sessionId
    this._router = router
    this._realmName = realmName
    this.engine = engine
    this.kvo = [] // key value order
  }

  getRouter () {
    return this._router
  }

  createActorEcho  (ctx, cmd) { return new Actor      (ctx, cmd) }
  createActorReg   (ctx, cmd) { return new ActorReg   (ctx, cmd) }
  createActorCall  (ctx, cmd) { return new ActorCall  (ctx, cmd) }
  createActorYield (ctx, cmd) { return new ActorYield (ctx, cmd) }
  createActorTrace (ctx, cmd) { return new ActorTrace (ctx, cmd) }
  createActorPush  (ctx, cmd) { return new ActorPush  (ctx, cmd) }

  doEcho (ctx, cmd) {
    const a = this.createActorEcho(ctx, cmd)
    a.acknowledged()
  }

  // RPC Management
  doRegRpc (ctx, cmd) {
    const session = ctx.getSession()
    // if (_rpcs.hasOwnProperty(cmd.uri)) {
    //     throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
    // }
    const actor = this.createActorReg(ctx, cmd)
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
      ctx.acknowledged(cmd)
      return registration.getUri()
    } else {
      throw new RealmError(cmd.id, errorCodes.ERROR_NO_SUCH_REGISTRATION)
    }
  }

  doCallRpc (ctx, cmd) {
    const actor = this.createActorCall(ctx, cmd)
    actor.taskId = tools.randomId()
    this.engine.doCall(actor)
    return actor.taskId
  }

  doYield (ctx, cmd) {
    const session = ctx.getSession()
    const invocation = this.engine.qYield.getDefer(session.sessionId, cmd.qid)
    if (invocation) {
      invocation.responseArrived(this.createActorYield(ctx, cmd))
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
    const subscription = this.createActorTrace(ctx, cmd)
    cmd.qid = this.engine.makeTraceId()

    session.addTrace(cmd.qid, subscription)
    this.engine.doTrace(subscription)
    if (subscription.getOpt().retained) {
      this.getKey(
        subscription.getUri(),
        (key, data) => {
          subscription.sendEvent({
            qid: null,
            uri: key,
            data: data,
            opt: { retained: true }
          })
        }
      )
    }
    this.emit(ON_SUBSCRIBED, subscription)

    return cmd.qid
  }

  doUnTrace (ctx, cmd) {
    const session = ctx.getSession()
    const subscription = session.removeTrace(this.engine, cmd.unr)
    if (subscription) {
      this.emit(ON_UNSUBSCRIBED, subscription)
      delete cmd.data
      ctx.acknowledged(cmd)
      return subscription.getUri()
    } else {
      throw new RealmError(cmd.id, 'wamp.error.no_such_subscription')
    }
  }

  doPush (ctx, cmd) {
    const actor = this.createActorPush(ctx, cmd)
    if (cmd.opt && cmd.opt.retain) {
      this.setKeyActor(actor)
    } else {
      this.engine.doPush(actor)
    }
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

  cleanupSession (session) {
    this.emit(SESSION_LEAVE, session)
    session.cleanupTrace(this.engine)
    session.cleanupReg(this.engine)

    for (let i = this.kvo.length - 1; i >= 0; i--) {
      this.kvo[i].kv.removeSession(session.sessionId)
    }

    this._sessions.delete(session.sessionId)
    session.setRealm(null)
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
      this._foxApi = new FoxApi(this)
      this.joinSession(this._foxApi)
    }
    return this._foxApi
  }

  wampApi () {
    if (!this._wampApi) {
      this._wampApi = new WampApi(this)
      this.joinSession(this._wampApi)
    }
    return this._wampApi
  }

  registerKeyValueEngine (uri, kv) {
    kv.setUriPattern(uri)
    kv.pubActor = (actor) => {
      this.engine.doPush(actor)
    }
    kv.confirm = (actor, cmd) => {
      actor.confirm(cmd)
    }
    this.kvo.push({ uri, kv })
  }

  setKeyData (uri, data) {
    for (let i = this.kvo.length - 1; i >= 0; i--) {
      const kvr = this.kvo[i]
      if (match(uri, kvr.uri)) {
        kvr.kv.setKeyData(extract(uri, kvr.uri), data)
        break
      }
    }
  }

  setKeyActor (actor) {
    const uri = actor.getUri()
    for (let i = this.kvo.length - 1; i >= 0; i--) {
      const kvr = this.kvo[i]
      if (match(uri, kvr.uri)) {
        kvr.kv.setKeyActor(actor)
        break
      }
    }
  }

  getKey (uri, cbRow) {
    const done = []
    for (let i = this.kvo.length - 1; i >= 0; i--) {
      const kvr = this.kvo[i]
      // console.log('MATCH++', uri, kvr.uri, extract(uri, kvr.uri))
      if (intersect(uri, kvr.uri)) {
        done.push(kvr.kv.getKey(
          extract(uri, kvr.uri),
          (aKey, data) => {
            cbRow(merge(aKey, kvr.uri), data)
          }
        ))
      }
    }
    return Promise.all(done)
  }
}

class ActorPushKv {
  constructor (uri, data, opt) {
    this.uri = uri
    this.data = data
    this.opt = opt
    this.eventId = null
  }

  getSid () {
    return null
  }

  getOpt () {
    return Object.assign({}, this.opt)
  }

  getUri () {
    return this.uri
  }

  getData () {
    return this.data
  }

  setEventId (id) {
    this.eventId = id
  }

  getEvent () {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      data: this.getData(),
      opt: this.getOpt()
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

  getUriPattern () {
    return this.uriPattern
  }

  createActorPushKv (uri, data, opt) {
    return new ActorPushKv(uri, data, opt)
  }

  // pubActor (actor) virtual abstract

  setKeyData (key, data) {
    this.setKeyActor(
      this.createActorPushKv(
        merge(key, this.uriPattern),
        data,
        {})
    )
  }

  // Promise:getKey (uri, cbRow) ::cbRow:: aKey, data
  // removeSession (sessionId)
}

class MemEngine extends BaseEngine {
  constructor () {
    super()
    this._messageGen = 0
    this._messages = []
  }

  dispatch (event, excludeSid) {
    // event.qid = ++this._messageGen
    return super.dispatch(event, excludeSid)
  }

  doPush (actor) {
    actor.setEventId(++this._messageGen)
    super.doPush(actor)
    if (actor.getOpt().trace) {
      this._messages.push(actor.getEvent())
      if (this._messages.length > 1100) {
        this._messages = this._messages.splice(100)
      }
    }
  }

  getHistoryAfter (after, uri, cbRow) {
    return new Promise((resolve, reject) => {
      for (let i = 0; i < this._messages.length; i++) {
        const event = this._messages[i]
        if (event.qid > after && match(event.uri, uri)) {
          cbRow(event)
        }
      }
      resolve()
    })
  }
}

exports.Actor = Actor
exports.ActorReg = ActorReg
exports.ActorCall = ActorCall
exports.ActorTrace = ActorTrace
exports.ActorPush = ActorPush

exports.ActorPushKv = ActorPushKv
exports.KeyValueStorageAbstract = KeyValueStorageAbstract

exports.isDataFit = isDataFit
exports.makeDataSerializable = makeDataSerializable
exports.unSerializeData = unSerializeData

exports.DeferMap = DeferMap
exports.BaseEngine = BaseEngine
exports.MemEngine = MemEngine
exports.BaseRealm = BaseRealm
