'use strict';

let
    Qlobber = require('qlobber').Qlobber,

    {SESSION_JOIN, SESSION_LEAVE, RESULT_EMIT, ON_SUBSCRIBED, ON_UNSUBSCRIBED,
        ON_REGISTERED, ON_UNREGISTERED} = require('./messages'),

    errorCodes = require('./realm_error').errorCodes,
    RealmError = require('./realm_error').RealmError,
    Api = require('./api'),
    Storage = require('./storage'),
    tools = require('./tools');

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
    constructor(session, msg) {
        this.session = session;
        this.msg = msg;
    }

    getOpt() {
        if (this.msg.opt !== undefined)
            return this.msg.opt;
        else
            return {};
    }

    acknowledged() {
        this.session.acknowledged(this.msg);
    }

    getSid() {
        return this.session.sessionId;
    }

    getRealm() {
        return this.session.realm;
    }
}

class ActorCall extends Actor {

    getData() {
        return this.msg.data;
    }

    getUri() {
        return this.msg.uri;
    }

    isActual() {
        return Boolean(this.session.realm);
    }

    responseArrived(actor) {
        let realm = this.getRealm();
        if (realm && actor.msg.rqt !== RESULT_EMIT) {
            realm.rpc.doneDefer(actor.getSid(), this.taskId);
        }

        this.session.gate.sendResult(this.session, {
            id:this.msg.id,
            err:actor.msg.err,
            data:actor.getData(),
            rsp:actor.msg.rqt
        });
    }
}

class ActorYield extends Actor {

    getData() {
        return this.msg.data;
    }
}

class ActorReg extends Actor
{
    callWorker(taskD)
    {
        taskD.destSID = {};
        taskD.destSID[this.getSid()] = true;

        this.session.taskRequested();  // mark worker busy
        this.getRealm().rpc.addDefer(taskD, taskD.taskId);

        this.session.gate.sendInvoke(this.session, {
            id:this.msg.id,
            qid:taskD.taskId,
            uri:taskD.getUri(),
            subId:this.subId,
            data:taskD.getData(),
            opt:taskD.getOpt()
        });
    }

    isAble() {
        return this.session.isAble();
    }

    getUri() {
        return this.msg.uri;
    }
}

class ActorPush extends Actor
{
    confirm(cmd) {
        if (!this.clientNotified)
        {
            this.clientNotified = true;
            if (this.needAck()) {
                let clone = Object.assign({}, cmd);
                clone.id = this.msg.id;
                clone.qid = this.markId;
                this.session.acknowledged(clone);
            }
//            this.realm.push.doneDefer(this.sid, this.markId);
        }
    }

    getData() {
        return this.msg.data;
    }

    getUri() {
        return this.msg.uri;
    }

    needAck() {
        return this.msg.ack;
    }

    getEvent() {
        return {
            qid:this.markId,
            uri:this.getUri(),
            data:this.getData(),
            opt:this.getOpt()
        };
    }
}

class ActorTrace extends Actor
{
    sendEvent(cmd) {
        cmd.id  = this.msg.id;
        cmd.traceId = this.msg.qid;

        this.session.gate.sendEvent(this.session, cmd);
    }

    getUri() {
        return this.msg.uri;
    }
}

class EngineBase {

    constructor() {
        /**
        reqest has been sent to worker/writer, the session is waiting for the YIELD
        CALL
            [deferId] = deferred
        */
       this.defers = new Map();
    }

    addDefer(actor, markId) {
        this.defers.set(markId, actor);
        return markId;
    }

    getDefer(sid, markId) {
        let result = this.defers.get(markId);
        if (result && result.destSID.hasOwnProperty(sid)) {
            return result;
        }
        else {
            return undefined;
        }
    }

    doneDefer(sid, markId) {
        let found = this.defers.get(markId);
        if (found && found.destSID.hasOwnProperty(sid)) {
            this.defers.delete(markId);
        }
    }
}

class EngineRpc extends EngineBase {

    constructor() {
        super();
        /**
        Subscribed Workewrs for queues
            [uri][sessionId] => actor
        */
        this.wSub = {};

        /**
        waiting for the apropriate worker (CALL)
            [uri][] = actor
        */
        this.qCall = new Map();
    }

    getSubStack(uri) {
      return (
        this.wSub.hasOwnProperty(uri) ?
        this.wSub[uri] :
          {}
      );
    }

    waitForResolver(uri, taskD) {
      if (!this.qCall.has(uri)) {
        this.qCall.set(uri, []);
      }
      this.qCall.get(uri).push(taskD);
    }

    addSub(uri, subD) {
      if (!this.wSub.hasOwnProperty(uri)) {
        this.wSub[uri] = {};
      }
      this.wSub[uri][subD.subId] = subD;
    }

    removeSub(uri, id) {
        delete this.wSub[uri][id];

        if (Object.keys(this.wSub[uri]).length === 0)
            delete this.wSub[uri];
    }

    checkTasks(subD)
    {
        if (this.qCall.has(subD.getUri())) {
            let taskD;
            let taskList = this.qCall.get(subD.getUri());

            do {
                taskD = taskList.shift();

                if (taskList.length === 0) {
                    this.qCall.delete(subD.getUri());
                }
                if (taskD && taskD.isActual()) {
                    subD.callWorker(taskD);
                    return true;
                }
            }
            while (taskD);
        }
        return false;
    }

    getPendingTaskCount() {
        return this.qCall.size;
    }

    doCall(taskD) {
        let queue = this.getSubStack(taskD.getUri());
        let subExists = false;
        for(var index in queue) {
            let subD = queue[index];
            subExists = true;
            if (subD.isAble()) {
                subD.callWorker(taskD);
                return null;
            }
        }

        if (!subExists) {
            throw new RealmError(taskD.msg.id,
                errorCodes.ERROR_NO_SUCH_PROCEDURE,
                ['no callee registered for procedure <'+taskD.getUri()+'>']
            );
        }

        // all workers are bisy, keep the message till to the one of them free
        this.waitForResolver(taskD.getUri(), taskD);
    }
}

class EnginePush extends EngineBase {

    constructor() {
        super();
        this.wTrace = new Qlobber();     // [uri][subscription]
    }

    makeTraceId() {
        return tools.randomId();
    }

    makeEventId() {
        return tools.randomId();
    }

    match(uri) {
        return this.wTrace.match(uri);
    }

    addTrace(subD) {
        this.wTrace.add(subD.getUri(), subD);
    }

    removeTrace(uri, subscription) {
        this.wTrace.remove(uri, subscription);
    }

    doTrace(actor) {
        this.addTrace(actor);
        actor.acknowledged();
    }

    actorPush(subD, actor) {
        subD.sendEvent(actor.getEvent());
    }

    actorConfirm(actor, cmd) {
        let clone = Object.assign({}, cmd);
        delete clone.data;
        actor.confirm(clone);
    }

    // By default, a Publisher of an event will not itself receive an event published,
    // even when subscribed to the topic the Publisher is publishing to.
    // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.

    doPush(actor) {
        actor.destSID = {};
        actor.clientNotified = false;
        this.addDefer(actor, actor.markId);

        let found = this.match(actor.getUri());
        for (let i = 0; i < found.length; i++) {
            let subD = found[i];
            actor.destSID[subD.getSid()] = true;

            if (actor.getSid() !== subD.getSid() ||
                (!actor.getOpt().exclude_me)
            ) {
                this.actorPush(subD, actor);
            }
        }
        this.actorConfirm(actor, actor.msg);
    }

    doConfirm(actor, cmd) {
        this.actorConfirm(actor, cmd);
    }
}

class BaseRealm {

    constructor(router, rpc, push, storage) {
        this._api = null;
        this._sessions = new Map();  // session by sessionId
        this._storage = storage;
        this._router = router;
        this.rpc = rpc;
        this.push = push;
    }

    api() {
        if (!this._api) {
            this._api = new Api(this);
            this.joinSession(this._api);
        }
        return this._api;
    }

    doEcho(session, cmd) {
        let a = new Actor(session, cmd);
        a.acknowledged();
    }

    // RPC Management
    doRegRpc(session, cmd) {
        // if (_rpcs.hasOwnProperty(cmd.uri)) {
        //     throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
        // }
        let actor = new ActorReg(session, cmd);
        actor.subId = tools.randomId();
        cmd.qid = actor.subId;
        this.rpc.addSub(cmd.uri, actor);
        session.addSub(actor.subId, actor);
        this._router.emit(ON_REGISTERED, this, actor);
        actor.acknowledged();
        return actor.subId;
    }

    doUnRegRpc(session, cmd) {
        let registration = session.removeSub(this.rpc, cmd.unr);
        if (registration) {
            this._router.emit(ON_UNREGISTERED, this, registration);
            delete cmd.data;
            session.acknowledged(cmd);
            return registration.getUri();
        }
        else {
            throw new RealmError(cmd.id, errorCodes.ERROR_NO_SUCH_REGISTRATION);
        }
    }

    doCallRpc(session, cmd) {
        let actor = new ActorCall(session, cmd);
        actor.taskId = tools.randomId();
        this.rpc.doCall(actor);
        return actor.taskId;
    }

    doYield(session, cmd) {
        let invocation = this.rpc.getDefer(session.sessionId, cmd.qid);
        if (invocation) {
            invocation.responseArrived(new ActorYield(session, cmd));
            session.taskResolved();
            session.checkWaitTask(this.rpc);
        }
        else {
            throw new RealmError(cmd.qid,
                errorCodes.ERROR_DEFER_NOT_FOUND,
                "The defer requested not found"
            );
        }
    }

    doConfirm(session, cmd) {
        let defer = this.push.getDefer(session.sessionId, cmd.qid);
        if (defer) {
            this.push.doConfirm(defer, cmd);
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
    doTrace(session, cmd) {
        let subscription = new ActorTrace(session, cmd);
        cmd.qid = this.push.makeTraceId();

        session.addTrace(cmd.qid, subscription);
        this.push.doTrace(subscription);
        this._router.emit(ON_SUBSCRIBED, this, subscription);

        this._storage.getKey(cmd.uri).then(
            (value) => {
                if (value) {
                    subscription.sendEvent({
                        qid:value[2],
                        uri:cmd.uri,
                        data:value[1],
                        opt:{}
                    });
                }
            },
            (reason) => {}
        );
        return cmd.qid;
    }

    doUnTrace(session, cmd) {
        let subscription = session.removeTrace(this.push, cmd.unr);
        if (subscription)
        {
            this._router.emit(ON_UNSUBSCRIBED, this, subscription);
            delete cmd.data;
            session.acknowledged(cmd);
            return subscription.getUri();
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_subscription");
        }
    }

    doPush(session, cmd) {
        let actor = new ActorPush(session, cmd);
        actor.markId = this.push.makeEventId();

        if (cmd.opt && cmd.opt.hasOwnProperty('retain')) {
            let sessionId = 0;
            if (cmd.opt.hasOwnProperty('weak')) {
                sessionId = session.sessionId;
            }
            this._storage.addKey(cmd.uri, sessionId, cmd.data, actor.markId);
        }

        this.push.doPush(actor);
    }

    getSession(sessionId) {
        return this._sessions.get(sessionId);
    }

    joinSession(session) {
        if (this._sessions.has(session.sessionId)) {
            throw new Error('Session already joined');
        }
        session.setRealm(this);
        this._sessions.set(session.sessionId, session);
        this._router.emit(SESSION_JOIN, this, session);
    }

    cleanupSession(session) {
        this._router.emit(SESSION_LEAVE, this, session);
        session.cleanupTrace(this.push);
        session.cleanupReg(this.rpc);
        this._storage.removeSession(session.sessionId);
        this._sessions.delete(session.sessionId);
        session.setRealm(null);
    }

    getKey(key) {
        return this._storage.getKey(key);
    }

    getSessionCount() {
        return this._sessions.size;
    }

    getSessionIds() {
        var result = [];
        for (var [sId, session] of this._sessions) {
            result.push(session.sessionId);
        }
        return result;
    }

    getSessionInfo(sessionId) {
        return {
            session: sessionId
        };
    }
}

class Realm extends BaseRealm {

    constructor(router) {
        super(
            router,
            new EngineRpc(),
            new EnginePush(),
            new Storage()
        );
    }
}

exports.Actor = Actor;
exports.ActorReg = ActorReg;
exports.ActorCall = ActorCall;
exports.ActorTrace =ActorTrace;
exports.ActorPush = ActorPush;

exports.EngineRpc = EngineRpc;
exports.EnginePush = EnginePush;
exports.BaseRealm = BaseRealm;
exports.Realm = Realm;
