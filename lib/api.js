
/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    inherits  = require('util').inherits,
    Session = require('./session'),
    tools = require('./tools');


function Api(realm) {
    Session.call(this);

    this.sender;
    this.gate = this;
    this.sessionId = tools.randomId();

    // API functions
    // regrpc callback = function(id, args, kwargs, opt)
    this.regrpc = function(uri, callback) {
        return realm.regrpc(this, {
            id: callback,
            uri: uri
        });
    };
    this.unregrpc = function(regId) {
        return realm.unregrpc(this, {
            qid:regId
        });
    };
    this.callrpc = function (uri, args, kwargs, callback, opt) {
        let cmd = {
            id:callback,
            uri,
            args,
            kwargs
        };
        if (opt && opt.receive_progress) {
            cmd.pgs = true;
        }
        return realm.callrpc(this, cmd);
    };
    this.resrpc = function (id, err, args, kwargs, opt) {
        return realm.resrpc(this, {
            id,
            err,
            data:{args,kwargs},
            opt
        });
    };
    this.substopic = function(uri, callback) {
        return realm.substopic(this, {
            id:callback,
            uri,
            opt:{}
        });
    };
    this.unsubstopic = function(topicId) {
        return realm.unsubstopic(this, {
            qid:topicId
        });
    };
    this.publish = function (uri, args, kwargs, opt) {
        return realm.publish(this, {uri, opt, data:{args, kwargs}});
    };

    // override/internal part
    this.sendInvoke = function (sender, cmd) {
        cmd.myd(cmd.id, cmd.data.args, cmd.data.kwargs, cmd.opt);
    };
    this.sendResult = function (sender, cmd) {
        cmd.id(cmd.err, cmd.data.args, cmd.data.kwargs, cmd.opt);
    };
    this.sendEvent = function (sender, cmd) {
        let kwargs;
        let args;
        if (cmd.data.args === undefined) {
            kwargs = cmd.data.payload;
        }
        else {
            args = cmd.data.args;
            kwargs = cmd.data.kwargs;
        }
        cmd.myd(cmd.id, args, kwargs, cmd.opt);
    };
    this.acknowledged = function(sender, cmd) {
//        console.log('ACK message not handled', cmd);
    };
}
inherits(Api, Session);

module.exports = Api;
