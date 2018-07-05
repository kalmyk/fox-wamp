/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    inherits  = require('util').inherits,
    Qlobber = require('qlobber').Qlobber,
    errorCodes = require('./realm_error').errorCodes,
    RealmError = require('./realm_error').RealmError,
    MSG = require('./messages'),
    Api = require('./api'),
    Storage = require('./storage'),
    tools = require('./tools');

/*
    message fields description

    uri
    qid    server generated id for PUSH/CALL/REG/TRACE
    ack    return acknowledge message for PUSH
    pgs    true/undefined - task proggress flag
    opt    options
*/

class Actor {
    constructor(realm, session, msg) {
        this.realm = realm;
        this.sid = session.sessionId;
        this.msg = msg;
    }

    getOpt() {
        return this.msg.opt;
    }

    acknowledged() {
        let session = this.realm.getSession(this.sid);
        session.gate.acknowledged(session, this.msg);
    }
}

class ActorCall extends Actor {

    getData(){
        return this.msg.data;
    }

    getUri() {
        return this.msg.uri;
    }

    responseArrived(actor)
    {
        if (!actor.msg.pgs) {
            this.realm.base.doneDefer(actor.sid, this.markId);
        }
    
        let session = this.realm.getSession(this.sid);
        session.gate.sendResult(session, {
            id:this.msg.id,
            err:actor.msg.err,
            data:actor.msg.data,
            pgs:actor.msg.pgs,
            res:actor.msg.rsp
        });
    }

    taskDone(session) {
        session.taskResolved();
        session.checkWaitTask(this.realm.rpc);
    }
}

class ActorReg extends Actor
{
    callWorker(taskD)
    {
        taskD.destSessionId = {};
        taskD.destSessionId[this.sid] = true;

        let workerSession = this.realm.getSession(this.sid);
        workerSession.taskRequested();  // mark worker busy
        this.realm.base.addDefer(taskD)
    
        let session = this.realm.getSession(this.sid);
        session.gate.sendInvoke(session, {
            id:this.msg.id,
            qid:taskD.markId,
            uri:taskD.getUri(),
            myd:this.subId,
            pgs:taskD.msg.pgs,
            data:taskD.getData(),
            opt:taskD.getOpt()
        });
    }
}

class ActorPush extends Actor
{
    responseArrived(actor) {
        if (!this.clientNotified)
        {
            this.clientNotified = true;
            if (this.msg.ack) {
                this.acknowledged();
            }
            
            this.realm.base.doneDefer(this.sid, this.markId);
        }
    }

    getData() {
        return this.msg.data;
    }

    getUri() {
        return this.msg.uri;
    }
}

class ActorTrace extends Actor
{
    sendEvent(pushD) {
        let session = this.realm.getSession(this.sid);
        session.gate.sendEvent(session, {
            id:this.msg.id,
            qid:pushD.markId,
            uri:pushD.getUri(),
            myd:this.traceId,
            data:pushD.getData(),
            opt:pushD.getOpt()
        });
    };
}
    
class EngineBase {

    constructor() {
        this.genNewId = 0;
        /**
        reqest has been sent to worker/writer, session is waiting for the SETTLE
        CALL/PUSH
            [deferId] = deferred
        */
        this.defers = new Map();
    }
    
    makeDeferId() {
        return ++this.genNewId;
    }
    
    addDefer(actor) {
        // TODO: change to exception
        if (!actor.markId)
            console.log('NO-MARK-ID', actor);
        
        this.defers.set(actor.markId, actor);
        return actor.markId;
    };
    
    getDefer(sessionId, markId) {
        let result = this.defers.get(markId);
        if (result && result.destSessionId.hasOwnProperty(sessionId))
        {
            return result;
        }
        else {
            return undefined;
        }
    };
    
    doneDefer(sessionId, markId)
    {
        let found = this.defers.get(markId);
        if (found && found.destSessionId.hasOwnProperty(sessionId))
        {
            this.defers.delete(markId);
        }
    };
}
      
class EngineRpc {

    constructor(base) {
      this.base = base;
      /**
        Subscribed Workewrs for queues
          [uri][sessionId] => actor
      */
      this.wSub = {};
  
      /**
        waiting for the apropriate worker (CALL)
          [uri][] = actor
      */
      this.qCall = {};
    }
  
    getSubStack(uri) {
      return (
        this.wSub.hasOwnProperty(uri) ?
        this.wSub[uri] :
          {}
      );
    };
  
    waitForResolver(uri, header)
    {
      if (!this.qCall.hasOwnProperty(uri))
      this.qCall[uri] = [];
  
      this.qCall[uri].push(header);
    };
  
    addSub(uri, subD) {
      if (!this.wSub.hasOwnProperty(uri)) {
        this.wSub[uri] = {};
      }
      this.wSub[uri][subD.subId] = subD;
    };
  
    removeSub(uri, id)
    {
        delete this.wSub[uri][id];

        if (Object.keys(this.wSub[uri]).length === 0)
            delete this.wSub[uri];
    };
  
    checkTasks(subD)
    {
      if (this.qCall.hasOwnProperty(subD.uri)) {
        var taskD = this.qCall[subD.uri].shift();
        if (this.qCall[subD.uri].length === 0)
          delete this.qCall[subD.uri];
  
        subD.callWorker(taskD);
        return true;
      }
      return false;
    };
  
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
  
        if (!subExists)
        {
            throw new RealmError(taskD.msg.id,
                errorCodes.ERROR_NO_SUCH_PROCEDURE,
                ['no callee registered for procedure <'+taskD.getUri()+'>']
            );
        }

      // all workers are bisy, keep the message till to the one of them free
      this.waitForResolver(taskD.getUri(), taskD);
    }
}
  
class EnginePush {

    constructor(base) {
        this.wTrace = new Qlobber();     // [uri][subscription]
        this.genTraceId = 0;
        this.base = base;
    }
  
    makeTraceId() {
        return ++this.genTraceId;
    }
  
    match(uri)
    {
        return this.wTrace.match(uri);
    };

    addTrace(subD)
    {
        this.wTrace.add(subD.uri, subD);
    };

    removeTrace(uri, subscription) {
        this.wTrace.remove(uri, subscription);
    };

    doTrace(actor) {
        this.addTrace(actor);
        actor.acknowledged();
    };
  
    actorPush(subD, actor) {
        subD.sendEvent(actor);
    };
  
    doPush(actor) {
        actor.destSessionId = {};
        actor.clientNotified = false;
    
        let found = this.match(actor.getUri());
        for (let i = 0; i < found.length; i++) {
            let subD = found[i];
            actor.destSessionId[subD.sid] = true;
    
            if (actor.sid !== subD.sid ||
                (actor.msg.opt && false === actor.msg.opt.exclude_me)
            ) {
                this.actorPush(subD, actor);
            }
        }
        actor.responseArrived(undefined /*actor*/);
    }
}
  
function BaseRealm(router, base, rpc, push) {
    var _api = null;
    var _sessions = new Map();  // session by sessionId
    var _storage = new Storage(this);

    this.base = base;
    this.rpc = rpc;
    this.push = push;

    this.api = function () {
        if (!_api) {
            _api = new Api(this);
            this.joinSession(_api);
        }
        return _api;
    };

    this.doEcho = function(session, cmd) {
        let a = new Actor(this, session, cmd);
        a.acknowledged();
    };

      // RPC Management
    this.doRegRpc = function(session, cmd) {
        // if (_rpcs.hasOwnProperty(cmd.uri)) {
        //     throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
        // }
        let actor = new ActorReg(this, session, cmd);
        actor.isAble = session.isAble;
        actor.subId = tools.randomId();
        cmd.qid = actor.subId;
        actor.uri = cmd.uri;
        this.rpc.addSub(cmd.uri, actor);
        session.addSub(actor.subId, actor);
        router.emit('RPCRegistered', this, cmd.uri);
        actor.acknowledged();
        return actor.subId;
    }

    this.doUnRegRpc = function(session, cmd) {
        let registration = session.removeSub(this.rpc, cmd.unr);
        if (registration)
        {
            router.emit('RPCUnRegistered', this, registration.uri);
            session.gate.acknowledged(session, cmd);
            return registration.uri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_registration");
        }
    }

    this.doCallRpc = function(session, cmd) {
        let actor = new ActorCall(this, session, cmd);
        actor.markId = tools.randomId();
        this.rpc.doCall(actor);
        return actor.markId;
    }

    this.doYield = function(session, cmd) {
        let invocation = this.base.getDefer(session.sessionId, cmd.qid);
        if (invocation) {
            invocation.responseArrived(new Actor(this, session, cmd));
            invocation.taskDone(session);
        }
        else {
            throw new RealmError(cmd.id,
                errorCodes.ERROR_DEFER_NOT_FOUND,
                "The defer requested not found"
            );
        }
    }

    this.doConfirm = function(session, cmd) {
        let invocation = this.base.getDefer(session.sessionId, cmd.qid);
        if (invocation) {
            invocation.responseArrived(new Actor(this, session, cmd));
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
    this.doTrace = function(session, cmd) {
        let topicId = tools.randomId();
        let subscription = new ActorTrace(this, session, cmd);
        subscription.uri = cmd.uri;
        subscription.traceId = topicId;
        cmd.qid = topicId;

        session.addTrace(topicId, subscription);
        this.push.addTrace(subscription);

        router.emit('Subscribed', this, cmd.uri);
        subscription.acknowledged();

        _storage.getKey(cmd.uri).then(
            (value) => {
                if (value) {
                    session.gate.sendEvent(session, {
                        qid:value[0],
                        id:cmd.id,
                        myd:topicId,
                        opt:{}, 
                        data:value[2]
                    });
                }
            },
            (reason) => {}
        );
        return topicId;
    }

    this.doUnTrace = function(session, cmd) {
        let subscription = session.removeTrace(this.push, cmd.unr);
        if (subscription)
        {
            router.emit('UnSubscribed', this, subscription.uri);
            session.gate.acknowledged(session, cmd);
            return subscription.uri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_subscription");
        }
    }

    // By default, a Publisher of an event will not itself receive an event published,
    // even when subscribed to the topic the Publisher is publishing to.
    // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.

    this.doPush = function(session, cmd) {
        let publicationId = tools.randomId();
        if (cmd.opt && cmd.opt.hasOwnProperty('retain')) {
            let sessionId = 0;
            if (cmd.opt.hasOwnProperty('weak')) {
              sessionId = session.sessionId;
            }
            _storage.addKey(cmd.uri, publicationId, sessionId, cmd.data);
        }

        let actor = new ActorPush(this, session, cmd);
        actor.markId = publicationId;
        this.push.doPush(actor);
    }

    this.getSession = function(sessionId) {
        return _sessions.get(sessionId);
    };

    this.joinSession = function(session) {
        if (_sessions.has(session.sessionId)) {
            throw new Error('Session already joined');
        }
        session.realm = this;
        _sessions.set(session.sessionId, session);
        router.emit(MSG.SESSION_JOIN, session, this);
    };

    this.cleanupSession = function(session) {
        router.emit(MSG.SESSION_LEAVE, session, this);
        session.cleanupTrace(this.push);
        session.cleanupReg(this.rpc);
        _storage.removeSession(session.sessionId);
        _sessions.delete(session.sessionId);
        session.realm = null;
    };

    this.getKey = function(key) {
        return _storage.getKey(key);
    };

    this.getSessionCount = function() {
        return _sessions.size;
    };

    this.getSessionIds = function () {
        var result = [];
        for (var [sId, session] of _sessions) {
            result.push(session.sessionId);
        }
        return result;
    };

    this.getSessionInfo = function (sessionId) {
        return {
            session: sessionId
        };
    };

    this.keyRemoved = function(key) {

    };
}

function Realm(router) {
    let base = new EngineBase();
    BaseRealm.call(this,
        router,
        base,
        new EngineRpc(base),
        new EnginePush(base)
    );
}

inherits(Realm, BaseRealm);

exports.Actor = Actor;
exports.ActorReg = ActorReg;
exports.ActorCall = ActorCall;
exports.ActorTrace =ActorTrace;
exports.ActorPush = ActorPush;

exports.EngineBase = EngineBase;
exports.EngineRpc = EngineRpc;
exports.EnginePush = EnginePush;
exports.BaseRealm = BaseRealm;
exports.Realm = Realm;
