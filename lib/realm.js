'use strict'

const Qlobber = require('qlobber').Qlobber

const { SESSION_JOIN, SESSION_LEAVE, RESULT_EMIT, ON_SUBSCRIBED, ON_UNSUBSCRIBED,
  ON_REGISTERED, ON_UNREGISTERED } = require('./messages')

const errorCodes = require('./realm_error').errorCodes
const RealmError = require('./realm_error').RealmError
const WampApi = require('./wamp/api')
const FoxApi = require('./fox_api')
const KeyStorage = require('./storage')
const tools = require('./tools')

/*
  message fields description

  uri
  qid    server generated id for PUSH/CALL/REG/TRACE
  ack    return acknowledge message for PUSH
  rsp    task response to client (OK, ERR, ACK, EMIT)
  rqt    request to broker
  unr    unregister ID, used in UNREG + UNTRACE
  opt    options
*/

class Actor {
  constructor (session, msg) {
    this.session = session
    this.msg = msg
  }

  getOpt () {
    if (this.msg.opt !== undefined) {
      return this.msg.opt
    } else {
      return {}
    }
  }

  acknowledged () {
    this.session.acknowledged(this.msg)
  }

  getSid () {
    return this.session.sessionId
  }

  getRealm () {
    // realm is not available when client already disconnected
    return this.session.realm
  }
}

class ActorCall extends Actor {
  constructor (session, msg) {
    super(session, msg)
    this.rpcEngine = session.realm.rpc
  }

  getData () {
    return this.msg.data
  }

  getUri () {
    return this.msg.uri
  }

  isActual () {
    return Boolean(this.session.realm)
  }

  setRegistration (registration) {
    this.registration = registration
  }

  getRegistration () {
    return this.registration
  }

  responseArrived (actor) {
    if (actor.msg.rqt !== RESULT_EMIT) {
      this.rpcEngine.doneDefer(actor.getSid(), this.taskId)
    }

    this.session.gate.sendResult(this.session, {
      id: this.msg.id,
      err: actor.msg.err,
      data: actor.getData(),
      rsp: actor.msg.rqt
    })

    let subD = this.getRegistration()
    subD.taskResolved()
    if (subD.isAble()) {
      this.rpcEngine.checkTasks(subD)
    }
  }
}

class ActorYield extends Actor {
  getData () {
    return this.msg.data
  }
}

class ActorReg extends Actor {
  constructor (session, msg) {
    super(session, msg)
    // tasks per worker unlimited if the value below zero
    this.simultaneousTaskLimit = 1
    this.tasksRequested = 0
  }

  callWorker (taskD) {
    taskD.destSID = {}
    taskD.destSID[this.getSid()] = true

    this.taskRequested() // mark worker busy
    taskD.setRegistration(this)
    this.getRealm().rpc.addDefer(taskD, taskD.taskId)

    this.session.gate.sendInvoke(this.session, {
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

  getUri () {
    return this.msg.uri
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
        this.session.acknowledged(clone)
      }
      // this.realm.push.doneDefer(this.sid, this.eventId)
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

class ActorTrace extends Actor {
  sendEvent (cmd) {
    cmd.id = this.msg.id
    cmd.traceId = this.msg.qid

    this.session.gate.sendEvent(this.session, cmd)
  }

  getUri () {
    return this.msg.uri
  }
}

class EngineBase {
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
    let result = this.defers.get(markId)
    if (result && result.destSID.hasOwnProperty(sid)) {
      return result
    } else {
      return undefined
    }
  }

  doneDefer (sid, markId) {
    let found = this.defers.get(markId)
    if (found && found.destSID.hasOwnProperty(sid)) {
      this.defers.delete(markId)
    }
  }
}

class EngineRpc extends EngineBase {
  constructor () {
    super()

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
    if (!this.wSub.hasOwnProperty(uri)) {
      this.wSub[uri] = {}
    }
    this.wSub[uri][subD.subId] = subD
  }

  removeSub (uri, id) {
    delete this.wSub[uri][id]

    if (Object.keys(this.wSub[uri]).length === 0) {
      delete this.wSub[uri]
    }
  }

  checkTasks (subD) {
    if (this.qCall.has(subD.getUri())) {
      let taskD
      let taskList = this.qCall.get(subD.getUri())

      do {
        taskD = taskList.shift()

        if (taskList.length === 0) {
          this.qCall.delete(subD.getUri())
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
    let queue = this.getSubStack(taskD.getUri())
    let subExists = false
    for (let index in queue) {
      let subD = queue[index]
      subExists = true
      if (subD.isAble()) {
        subD.callWorker(taskD)
        return null
      }
    }

    if (!subExists) {
      throw new RealmError(taskD.msg.id,
        errorCodes.ERROR_NO_SUCH_PROCEDURE,
        ['no callee registered for procedure <' + taskD.getUri() + '>']
      )
    }

    // all workers are bisy, keep the message till to the one of them free
    this.waitForResolver(taskD.getUri(), taskD)
  }
}

class EnginePush extends EngineBase {
  constructor () {
    super()
    this.wTrace = new Qlobber() // [uri][subscription]
  }

  makeTraceId () {
    return tools.randomId()
  }

  match (uri) {
    return this.wTrace.match(uri)
  }

  addTrace (subD) {
    this.wTrace.add(subD.getUri(), subD)
  }

  removeTrace (uri, subscription) {
    this.wTrace.remove(uri, subscription)
  }

  doTrace (actor) {
    this.addTrace(actor)
    actor.acknowledged()
  }

  actorPush (subD, actor) {
    subD.sendEvent(actor.getEvent())
  }

  actorConfirm (actor, cmd) {
    let clone = Object.assign({}, cmd)
    delete clone.data
    actor.confirm(clone)
  }

  // By default, a Publisher of an event will not itself receive an event published,
  // even when subscribed to the topic the Publisher is publishing to.
  // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.
  dispatch (actor) {
    actor.destSID = {}
    actor.clientNotified = false

    let found = this.match(actor.getUri())
    for (let i = 0; i < found.length; i++) {
      let subD = found[i]
      actor.destSID[subD.getSid()] = true

      if (actor.getSid() !== subD.getSid() ||
        (!actor.getOpt().exclude_me)
      ) {
        this.actorPush(subD, actor)
      }
    }
    this.actorConfirm(actor, actor.msg)
  }

  doPush (actor) {
    actor.setEventId(tools.randomId())
    this.addDefer(actor, actor.eventId)
    this.dispatch(actor)
  }

  doConfirm (actor, cmd) {
    this.actorConfirm(actor, cmd)
  }
}

class BaseRealm {
  constructor (router, rpc, push, storage) {
    this._sessions = new Map() // session by sessionId
    this._storage = storage
    this._router = router
    this.rpc = rpc
    this.push = push
  }

  createContext (session) {
    let ctx = this._router.createContext()
    ctx.addSession(session)
    return ctx
  }

  doEcho (session, cmd) {
    let a = new Actor(session, cmd)
    a.acknowledged()
  }

  // RPC Management
  doRegRpc (session, cmd) {
    // if (_rpcs.hasOwnProperty(cmd.uri)) {
    //     throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
    // }
    let actor = new ActorReg(session, cmd)
    actor.subId = tools.randomId()
    if (cmd.opt.hasOwnProperty('simultaneousTaskLimit')) {
      actor.setSimultaneousTaskLimit(cmd.opt.simultaneousTaskLimit)
    }
    cmd.qid = actor.subId
    this.rpc.addSub(cmd.uri, actor)
    session.addSub(actor.subId, actor)
    this._router.emit(ON_REGISTERED, this, actor)
    actor.acknowledged()
    return actor.subId
  }

  doUnRegRpc (session, cmd) {
    let registration = session.removeSub(this.rpc, cmd.unr)
    if (registration) {
      this._router.emit(ON_UNREGISTERED, this, registration)
      delete cmd.data
      session.acknowledged(cmd)
      return registration.getUri()
    } else {
      throw new RealmError(cmd.id, errorCodes.ERROR_NO_SUCH_REGISTRATION)
    }
  }

  doCallRpc (session, cmd) {
    let actor = new ActorCall(session, cmd)
    actor.taskId = tools.randomId()
    this.rpc.doCall(actor)
    return actor.taskId
  }

  doYield (session, cmd) {
    let invocation = this.rpc.getDefer(session.sessionId, cmd.qid)
    if (invocation) {
      invocation.responseArrived(new ActorYield(session, cmd))
    } else {
      throw new RealmError(cmd.qid,
        errorCodes.ERROR_DEFER_NOT_FOUND,
        'The defer requested not found'
      )
    }
  }

  doConfirm (session, cmd) {
    let defer = this.push.getDefer(session.sessionId, cmd.qid)
    if (defer) {
      this.push.doConfirm(defer, cmd)
    }
  }

  // declare wamp.topic.history.after (uri, arg)
  // last    limit|integer
  // since   timestamp|string  ISO-8601 "2013-12-21T13:43:11:000Z"
  // after   publication|id

  // { match: "exact" }
  // { match: "prefix" }    session.subscribe('com.myapp',
  // { match: "wildcard" }  session.subscribe('com.myapp..update',

  // Topic Management
  doTrace (session, cmd) {
    let subscription = new ActorTrace(session, cmd)
    cmd.qid = this.push.makeTraceId()

    session.addTrace(cmd.qid, subscription)
    this.push.doTrace(subscription)
    this._router.emit(ON_SUBSCRIBED, this, subscription)

    this._storage.getKey(cmd.uri).then(
      (value) => {
        if (value) {
          subscription.sendEvent({
            qid: value[2],
            uri: cmd.uri,
            data: value[1],
            opt: {}
          })
        }
      },
      (reason) => {}
    )
    return cmd.qid
  }

  doUnTrace (session, cmd) {
    let subscription = session.removeTrace(this.push, cmd.unr)
    if (subscription) {
      this._router.emit(ON_UNSUBSCRIBED, this, subscription)
      delete cmd.data
      session.acknowledged(cmd)
      return subscription.getUri()
    } else {
      throw new RealmError(cmd.id, 'wamp.error.no_such_subscription')
    }
  }

  doPush (session, cmd) {
    let actor = new ActorPush(session, cmd)
    this.push.doPush(actor)

    if (cmd.opt && cmd.opt.hasOwnProperty('retain')) {
      let sessionId = 0
      if (cmd.opt.hasOwnProperty('weak')) {
        sessionId = session.sessionId
      }
      this._storage.addKey(cmd.uri, sessionId, cmd.data, actor.eventId)
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
    this._router.emit(SESSION_JOIN, this, session)
  }

  cleanupSession (session) {
    this._router.emit(SESSION_LEAVE, this, session)
    session.cleanupTrace(this.push)
    session.cleanupReg(this.rpc)
    this._storage.removeSession(session.sessionId)
    this._sessions.delete(session.sessionId)
    session.setRealm(null)
  }

  getKey (key) {
    return this._storage.getKey(key)
  }

  getSessionCount () {
    return this._sessions.size
  }

  getSessionIds () {
    var result = []
    for (var [sId, session] of this._sessions) {
      result.push(session.sessionId)
    }
    return result
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
}

class Realm extends BaseRealm {
  constructor (router) {
    super(
      router,
      new EngineRpc(),
      new EnginePush(),
      new KeyStorage()
    )
    this._wampApi = null
  }

  wampApi () {
    if (!this._wampApi) {
      this._wampApi = new WampApi(this)
      this.joinSession(this._wampApi)
    }
    return this._wampApi
  }
}

exports.Actor = Actor
exports.ActorReg = ActorReg
exports.ActorCall = ActorCall
exports.ActorTrace = ActorTrace
exports.ActorPush = ActorPush

exports.EngineRpc = EngineRpc
exports.EnginePush = EnginePush
exports.BaseRealm = BaseRealm
exports.Realm = Realm
