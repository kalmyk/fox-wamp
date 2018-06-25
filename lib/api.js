
/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    tools = require('./tools');


function ApiGate(realm) {
};

function Api(realm) {
    let _callback = {};
    let _rpc = {};

    this.sender;
    this.gate = this;
    this.sessionId = tools.randomId();

    // API functions
    // regrpc callback = function(id, args, kwargs, opt)
    this.regrpc = function(uri, callback) {
        let regId = realm.regrpc(this, {
            id: tools.randomId(),
            uri: uri
        });
        if (regId) {
            _rpc[regId] = callback;
        }
        return regId;
    };
    this.unregrpc = function(regId) {
        var uri = realm.unregrpc(this, {
            id:tools.randomId(),
            qid:regId
        });
        delete _rpc[regId];
        return uri;
    };
    this.callrpc = function (uri, args, kwargs, callback, opt) {
        var id = tools.randomId();
        if (realm.callrpc(this, {
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
        return realm.resrpc(this, {
            id,
            err,
            args,
            kwargs,
            opt
        });
    };
    this.substopic = function(uri, callback) {
        var topicId = realm.substopic(this, {
            id:tools.randomId(),
            uri,
            opt:{}
        });
        _rpc[topicId] = callback;
        return topicId;
    };
    this.unsubstopic = function(topicId) {
        delete _rpc[topicId];
        return realm.unsubstopic(this, {
            id:false,
            qid:topicId
        });
    };
    this.publish = function (uri, args, kwargs, opt) {
        return realm.publish(this, {uri, opt, data:{args, kwargs}});
    };

    // override/internal part
    this.sendInvoke = function (sender, cmd) {
        if (_rpc.hasOwnProperty(cmd.qid)) {
            _rpc[cmd.qid](cmd.id, cmd.data.args, cmd.data.kwargs, cmd.opt);
        }
    };
    this.sendResult = function (sender, cmd) {
        let callback = _callback[cmd.id];
        if (!cmd.opt || !cmd.opt.progress) {
            delete _callback[cmd.id];
        }
        callback(undefined, cmd.data.args, cmd.data.kwargs, cmd.opt);
    };
    this.sendEvent = function (sender, cmd) {
        if (_rpc.hasOwnProperty(cmd.qid)) {
            let kwargs;
            let args;
            if (cmd.data.args === undefined) {
                kwargs = cmd.data.payload;
            }
            else {
                kwargs = cmd.data.kwargs;
                args = cmd.data.args;
            }
            _rpc[cmd.qid](cmd.id, args, kwargs, cmd.opt);
        }
    };
    this.sendCallError = function (sender, cmd) {
      let callback = _callback[cmd.id];
      delete _callback[cmd.id];
      callback(cmd.err, cmd.data.args, cmd.data.kwargs, cmd.opt);
    };

    this.acknowledged = function(sender, cmd) {
//        console.log('ACK message not handled', cmd);
    };
}

module.exports = Api;
