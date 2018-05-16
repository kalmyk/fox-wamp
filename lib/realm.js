/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    Qlobber = require('qlobber').Qlobber,
    WAMP = require('./protocol'),
    RealmError = require('./realm_error').RealmError,
    MSG = require('./messages'),
    handlers = require('./handlers'),
    Storage = require('./storage'),
    tools = require('./tools');

function Api(router, realm) {
    let _callback = {};
    let _rpc = {};

    handlers.call(this);
    this.sessionId = tools.randomId();

    // API functions
    // regrpc callback = function(id, args, kwargs, opt)
    this.regrpc = function(uri, callback) {
        let regId = realm.handle(this, {
            mtype: WAMP.REGISTER,
            id: tools.randomId(),
            uri: uri
        });
        if (regId) {
            _rpc[regId] = callback;
        }
        return regId;
    };
    this.unregrpc = function(regId) {
        var uri = realm.handle(this, {
            mtype: WAMP.UNREGISTER,
            id:tools.randomId(),
            qid:regId
        });
        delete _rpc[regId];
        return uri;
    };
    this.callrpc = function (uri, args, kwargs, callback, opt) {
        var id = tools.randomId();
        if (realm.handle(this, {
            mtype: WAMP.CALL,
            id,
            uri,
            opt,
            args,
            kwargs}))
        {
            _callback[id] = callback;
        }
    };
    this.resrpc = function (id, err, args, kwargs, opt) {
        return realm.handle(this, {
            mtype: WAMP.YIELD,
            id,
            err,
            args,
            kwargs,
            opt
        });
    };
    this.substopic = function(uri, callback) {
        var topicId = realm.handle(this, {
            mtype: WAMP.SUBSCRIBE,
            id:tools.randomId(),
            uri,
            opt:{}
        });
        _rpc[topicId] = callback;
        return topicId;
    };
    this.unsubstopic = function(topicId) {
        delete _rpc[topicId];
        return realm.handle(this, {
            mtype: WAMP.UNSUBSCRIBE,
            id:false,
            qid:topicId
        });
    };
    this.publish = function (uri, args, kwargs, opt) {
        var id = tools.randomId();
        return realm.handle(this, {mtype: WAMP.PUBLISH, id, uri, opt, args, kwargs});
    };

    // override/internal part
    this.sendInvoke = function (regId, invId, args, kwargs, opt) {
        if (_rpc.hasOwnProperty(regId)) {
            _rpc[regId](invId, args, kwargs, opt);
        }
    };
    this.sendResult = function (id, err, args, kwargs, opt) {
        var callback = _callback[id];
        if (!opt || !opt.progress) {
            delete _callback[id];
        }
        callback(err, args, kwargs, opt);
    };
    this.sendEvent = function (subscriptionId, publicationId, args, kwargs, eventOpts) {
        if (_rpc.hasOwnProperty(subscriptionId)) {
            _rpc[subscriptionId](publicationId, args, kwargs, eventOpts);
        }
    };
    this.send = function (msg) {
//        console.log('API message not handled', msg);
    };
}

function Realm(router, realmName) {
    var _sessRPC = {};
    var _sessTopic = {};  // topics by sessionId

    var _rpcs = {};       // by uri
    var _topics = new Qlobber();     // [topicUri][subscription]
    var _pending = new Map();
    var _api = null;
    var _sessions = new Map();  // session by sessionId
    var _storage = new Storage(this);

    this.api = function () {
        if (!_api) {
            _api = new Api(router, this);
            this.joinSession(_api);
        }
        return _api;
    };

    this.getRealmDetails = function() {
      return {
        realm: realmName,
        roles: {
          broker: {
            features: {
              session_meta_api: true,
              publisher_exclusion: true
            }
          },
          dealer: {
            features:{
              session_meta_api: true,
              progressive_call_results: true
            }
          }
        }
      };
    };

    // RPC Management
    function regrpc(session, cmd) {
        if (_rpcs.hasOwnProperty(cmd.uri)) {
            throw new RealmError(cmd.id, "wamp.error.procedure_already_exists");
        }
        var qid = tools.randomId();
        _rpcs[cmd.uri] = {sessionId:session.sessionId, regId:qid};
        if (!_sessRPC.hasOwnProperty(session.sessionId))
            _sessRPC[session.sessionId] = {};
        _sessRPC[session.sessionId][qid] = cmd.uri;
        router.emit('RPCRegistered', this, cmd.uri);
        cmd.qid = qid;
        session.acknowledged(cmd);
        return qid;
    }

    function _unregrpc(sessionId, qid) {
        let procUri = _sessRPC[sessionId][qid];
        delete _rpcs[procUri];
        delete _sessRPC[sessionId][qid];
        router.emit('RPCUnRegistered', this, procUri);
        return procUri;
    }

    function unregrpc(session, cmd) {
        if (_sessRPC.hasOwnProperty(session.sessionId) &&
            _sessRPC[session.sessionId].hasOwnProperty(cmd.qid))
        {
            let procUri = _unregrpc(session.sessionId, cmd.qid);
            session.acknowledged(cmd);
            return procUri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_registration");
        }
    }

    function callrpc(session, cmd) {
        if (!_rpcs.hasOwnProperty(cmd.uri)) {
            throw new RealmError(cmd.id, "wamp.error.no_such_procedure", ['no callee registered for procedure <'+cmd.uri+'>']);
        }
        var destSession = this.getSession(_rpcs[cmd.uri].sessionId);
        if (destSession) {
            var invId = tools.randomId();
            _pending.set(invId, [cmd.id, session.sessionId]);
            var invOpts = {};
            if (cmd.opt && cmd.opt.receive_progress) {
                invOpts.receive_progress = true;
            }
            destSession.sendInvoke(_rpcs[cmd.uri].regId, invId, cmd.args, cmd.kwargs, invOpts);
            return invId;
        }
        else {
            delete _rpcs[cmd.uri];
        }
        return false;
    }

    function resrpc(session, cmd) {
        var resOpts = {};
        if (cmd.opt && cmd.opt.progress) {
          resOpts.progress = true;
        }
        if (_pending.has(cmd.id)) {
            let invocation = _pending.get(cmd.id);
            let destSession = this.getSession(invocation[1]);
            if (destSession) {
                destSession.sendResult(invocation[0], cmd.err, cmd.args, cmd.kwargs, resOpts);
            }
        }
        if (!resOpts.progress) {
            _pending.delete(cmd.id);
        }
    }

    // Topic Management
    function substopic(session, cmd) {
        let topicId = tools.randomId();
        let subscription = {topicId:topicId, topicUri:cmd.uri, sessionId:session.sessionId};
        if (!_sessTopic.hasOwnProperty(session.sessionId)) {
            _sessTopic[session.sessionId] = {};
        }
        _sessTopic[session.sessionId][topicId] = subscription;
        _topics.add(cmd.uri, subscription);

        router.emit('Subscribed', this, cmd.uri);
        cmd.qid = topicId;
        session.acknowledged(cmd);
        _storage.getKey(cmd.uri).then(
            (value) => {
                if (value) {
                    let id = value[0];
                    let args = value[2];
                    let kwArgs = value[3];
                    session.sendEvent(topicId, id, args, kwArgs, {});
                }
            },
            (reason) => {}
        );
        return topicId;
    }

    function _unsubstopic(sessionId, qid) {
        let subscription = _sessTopic[sessionId][qid];
        _topics.remove(subscription.topicUri, subscription);
        delete _sessTopic[sessionId][qid];
        router.emit('UnSubscribed', this, subscription.topicUri);
        return subscription.topicUri;
    }

    function unsubstopic(session, cmd) {
        if (_sessTopic.hasOwnProperty(session.sessionId) &&
            _sessTopic[session.sessionId].hasOwnProperty(cmd.qid))
        {
            let topicUri = _unsubstopic(session.sessionId, cmd.qid);
            session.acknowledged(cmd);
            return topicUri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_subscription");
        }
    }

    // By default, a Publisher of an event will not itself receive an event published,
    // even when subscribed to the topic the Publisher is publishing to.
    // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.

    function publish(session, cmd) {
        let publicationId = tools.randomId();
        if (cmd.opt && cmd.opt.hasOwnProperty('retain')) {
            let sessionId = 0;
            if (cmd.opt.hasOwnProperty('weak')) {
              sessionId = session.sessionId;
            }
            _storage.addKey(cmd.uri, publicationId, sessionId, cmd.args, cmd.kwargs);
        }

        let found = _topics.match(cmd.uri);
        let eventOpts = {topic:cmd.uri};
        for (let i = 0; i < found.length; i++) {
            let destSession = this.getSession(found[i].sessionId);
            if (destSession) {
                if (session.sessionId !== destSession.sessionId ||
                  (cmd.opt && false === cmd.opt.exclude_me)
                ) {
                    destSession.sendEvent(
                        parseInt(found[i].topicId),
                        publicationId,
                        cmd.args,
                        cmd.kwargs,
                        eventOpts
                    );
                }
            }
            else {
                _topics.remove(cmd.uri, found[i]);
            }
        }

        var ack = cmd.opt && cmd.opt.acknowledge;
        router.emit('Publish', this, cmd.uri, cmd.args, cmd.kwargs, ack);
        if (ack) {
            cmd.qid = publicationId;
            session.acknowledged(cmd);
        }
    }

    let handlers = {};

    handlers[WAMP.REGISTER]     = regrpc;
    handlers[WAMP.UNREGISTER]   = unregrpc;
    handlers[WAMP.CALL]         = callrpc;
    handlers[WAMP.SUBSCRIBE]    = substopic;
    handlers[WAMP.UNSUBSCRIBE]  = unsubstopic;
    handlers[WAMP.PUBLISH]      = publish;
    handlers[WAMP.YIELD]        = resrpc;
    handlers[WAMP.ERROR]        = resrpc;

    this.handle = function(session, cmd) {
        return handlers[cmd.mtype].call(this, session, cmd);
    };

    this.cleanupRPC = function(session) {
        var procIds = [];
        var procUris = [];
        if (_sessRPC.hasOwnProperty(session.sessionId)) {
            for (var regId in _sessRPC[session.sessionId])
                procIds.push(regId);
            for (var i=0; i<procIds.length; i++)
                procUris.push(_unregrpc(session.sessionId, procIds[i]));
            delete _sessRPC[session.sessionId];
        }
        return procUris;
    };

    this.cleanupTopic = function(session) {
        var topicIds = [];
        var topicUris = [];
        if (_sessTopic.hasOwnProperty(session.sessionId)) {
            for (var topicId in _sessTopic[session.sessionId])
                topicIds.push(topicId);
            for (var i=0; i<topicIds.length; i++)
                topicUris.push(_unsubstopic(session.sessionId,topicIds[i]));
            delete _sessTopic[session.sessionId];
        }
        return topicUris;
    };

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

    this.cleanup = function(session) {
        router.emit(MSG.SESSION_LEAVE, session, this);
        this.cleanupTopic(session);
        this.cleanupRPC(session);
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

module.exports = Realm;
