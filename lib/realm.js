/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    Qlobber = require('qlobber').Qlobber,
    WAMP = require('./wamp/gate'),
    RealmError = require('./realm_error').RealmError,
    MSG = require('./messages'),
    Api = require('./api'),
    Storage = require('./storage'),
    tools = require('./tools');

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
            _api = new Api(this);
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
    this.regrpc = function(session, cmd) {
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
        session.gate.acknowledged(session.sender, cmd);
        return qid;
    }

    function _unregrpc(sessionId, qid) {
        let procUri = _sessRPC[sessionId][qid];
        delete _rpcs[procUri];
        delete _sessRPC[sessionId][qid];
        router.emit('RPCUnRegistered', this, procUri);
        return procUri;
    }

    this.unregrpc = function(session, cmd) {
        if (_sessRPC.hasOwnProperty(session.sessionId) &&
            _sessRPC[session.sessionId].hasOwnProperty(cmd.qid))
        {
            let procUri = _unregrpc(session.sessionId, cmd.qid);
            session.gate.acknowledged(session.sender, cmd);
            return procUri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_registration");
        }
    }

    this.callrpc = function(session, cmd) {
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
            destSession.gate.sendInvoke(destSession.sender, {
                qid: _rpcs[cmd.uri].regId,
                id: invId,
                data:{args:cmd.args,kwargs:cmd.kwargs},
                opt:invOpts
            });
            return invId;
        }
        else {
            delete _rpcs[cmd.uri];
        }
        return false;
    }

    this.resrpc = function(session, cmd) {
        var resOpts = {};
        if (cmd.opt && cmd.opt.progress) {
          resOpts.progress = true;
        }
        if (_pending.has(cmd.id)) {
            let invocation = _pending.get(cmd.id);
            let destSession = this.getSession(invocation[1]);
            if (destSession) {
                if (cmd.err) {
                    destSession.gate.sendCallError(destSession.sender, {
                        id:invocation[0],
                        err:cmd.err,
                        data:{
                            args:cmd.args,
                            kwargs:cmd.kwargs
                        },
                        opt:resOpts
                    });
                }
                else {
                    destSession.gate.sendResult(destSession.sender, {
                        id:invocation[0],
                        data:{
                            args:cmd.args,
                            kwargs:cmd.kwargs,
                        },
                        opt:resOpts
                    });
                }
            }
        }
        if (!resOpts.progress) {
            _pending.delete(cmd.id);
        }
    }

    // Topic Management
    this.substopic = function(session, cmd) {
        let topicId = tools.randomId();
        let subscription = {topicId:topicId, topicUri:cmd.uri, sessionId:session.sessionId};
        if (!_sessTopic.hasOwnProperty(session.sessionId)) {
            _sessTopic[session.sessionId] = {};
        }
        _sessTopic[session.sessionId][topicId] = subscription;
        _topics.add(cmd.uri, subscription);

        router.emit('Subscribed', this, cmd.uri);
        cmd.qid = topicId;
        session.gate.acknowledged(session.sender, cmd);

        _storage.getKey(cmd.uri).then(
            (value) => {
                if (value) {
                    session.gate.sendEvent(session.sender, {
                        qid:topicId,
                        id:value[0],
                        opt:{}, 
                        data:value[2]
                    });
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

    this.unsubstopic = function(session, cmd) {
        if (_sessTopic.hasOwnProperty(session.sessionId) &&
            _sessTopic[session.sessionId].hasOwnProperty(cmd.qid))
        {
            let topicUri = _unsubstopic(session.sessionId, cmd.qid);
            session.gate.acknowledged(session.sender, cmd);
            return topicUri;
        }
        else {
            throw new RealmError(cmd.id, "wamp.error.no_such_subscription");
        }
    }

    // By default, a Publisher of an event will not itself receive an event published,
    // even when subscribed to the topic the Publisher is publishing to.
    // If supported by the Broker, this behavior can be overridden via the option exclude_me set to false.

    this.publish = function(session, cmd) {
        let publicationId = tools.randomId();
        if (cmd.opt && cmd.opt.hasOwnProperty('retain')) {
            let sessionId = 0;
            if (cmd.opt.hasOwnProperty('weak')) {
              sessionId = session.sessionId;
            }
            _storage.addKey(cmd.uri, publicationId, sessionId, cmd.data);
        }

        let found = _topics.match(cmd.uri);
        let eventOpts = {topic:cmd.uri};
        for (let i = 0; i < found.length; i++) {
            let destSession = this.getSession(found[i].sessionId);
            if (destSession) {
                if (session.sessionId !== destSession.sessionId ||
                  (cmd.opt && false === cmd.opt.exclude_me)
                ) {
                    destSession.gate.sendEvent(destSession.sender, {
                        qid:parseInt(found[i].topicId),
                        id:publicationId,
                        data:cmd.data,
                        opt:eventOpts
                    });
                }
            }
            else {
                _topics.remove(cmd.uri, found[i]);
            }
        }

        var ack = cmd.opt && cmd.opt.acknowledge;
        if (ack) {
            cmd.qid = publicationId;
            session.gate.acknowledged(session.sender, cmd);
        }
    }

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
