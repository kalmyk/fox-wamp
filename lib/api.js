'use strict';

let
    inherits  = require('util').inherits,
    {RESULT_EMIT} = require('./messages'),
    dparse = require('./wamp/dparse'),
    Session = require('./session'),
    tools = require('./tools');

function Api(realm) {
    Session.call(this);

    this.gate = this;
    this.sessionId = tools.randomId();

    // API functions
    // regrpc callback = function(id, args, kwargs, opt)
    this.regrpc = function(uri, callback) {
        return realm.doRegRpc(this, {
            id: callback,
            uri: uri
        });
    };
    this.unregrpc = function(regId) {
        return realm.doUnRegRpc(this, {
            unr:regId
        });
    };
    this.callrpc = function (uri, args, kwargs, callback, opt) {
        return realm.doCallRpc(this, {
            id:callback,
            uri,
            data:{args,kwargs},
            opt: opt || {}
        });
    };
    this.resrpc = function (qid, err, args, kwargs, opt) {
        return realm.doYield(this, {
            qid,
            err,
            data:{args,kwargs},
            opt: opt || {}
        });
    };
    this.substopic = function(uri, callback) {
        return realm.doTrace(this, {
            id:callback,
            uri,
            opt:{}
        });
    };
    this.unsubstopic = function(topicId) {
        return realm.doUnTrace(this, {
            unr:topicId
        });
    };
    this.publish = function (uri, args, kwargs, opt) {
        opt = opt || {};
        if (false !== opt.exclude_me) {
            opt.exclude_me = true;
        }
        return realm.doPush(this, {uri, opt, data:{args, kwargs}});
    };

    // override/internal part
    this.sendInvoke = function (sender, cmd) {
        let [args, kwargs] = dparse(cmd.data);
        cmd.id(cmd.qid, args, kwargs, cmd.opt);
    };

    this.sendResult = function (sender, cmd) {
        let resOpt = {};
        if (cmd.rsp === RESULT_EMIT) {
            resOpt.progress = true;
        }
        let [args, kwargs] = dparse(cmd.data);
        cmd.id(cmd.err, args, kwargs, resOpt);
    };

    this.sendEvent = function (sender, cmd) {
        let [args, kwargs] = dparse(cmd.data);
        cmd.id(cmd.qid, args, kwargs, cmd.opt);
    };

    this.acknowledged = function(cmd) {
//        console.log('ACK message not handled', cmd);
    };
}
inherits(Api, Session);

module.exports = Api;
