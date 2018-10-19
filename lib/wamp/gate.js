/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    WAMP = require('./protocol'),
    {RESULT_EMIT, RESULT_OK} = require('../messages'),
    BaseGate = require('../base_gate'),
    RealmError = require('../realm_error').RealmError,
    errorCodes = require('../realm_error').errorCodes;

let errorMessages = {};

errorMessages[errorCodes.ERROR_NO_SUCH_PROCEDURE] = "wamp.error.no_such_procedure";

let handlers = {},
    cmdAck   = {};

class WampEncoder {
    sendInvoke(session, cmd) {
        let invOpts = {};
        if (cmd.rsp === RESULT_EMIT) {
            invOpts.receive_progress = true;
        }
        let msg = [
            WAMP.INVOCATION,
            cmd.qid,
            cmd.subId,
            invOpts,
        ];
        if (undefined !== cmd.data.args)   msg.push(cmd.data.args);
        if (undefined !== cmd.data.kwargs) msg.push(cmd.data.kwargs);

        session.send(msg);
    }

    sendResult(session, cmd) {
        if (cmd.err) {
            this.wampSendError(session, WAMP.CALL, cmd.id, "wamp.error.callee_failure", cmd.data.args);
            return;
        }

        let resOpt = {};
        if (cmd.rsp === RESULT_EMIT) {
            resOpt.progress = true;
        }

        var msg = [
            WAMP.RESULT,
            cmd.id,
            resOpt,
        ];
        if (undefined !== cmd.data.args)   msg.push(cmd.data.args);
        if (undefined !== cmd.data.kwargs) msg.push(cmd.data.kwargs);
        session.send(msg);
    }

    sendEvent(session, cmd) {
        let eventOpt = {
            topic:cmd.uri
        };
        var msg = [
            WAMP.EVENT,
            cmd.traceId,
            cmd.qid,
            eventOpt
        ];
        // Manage optional parameters args + kwargs
        if (cmd.data.args !== undefined) {
            msg.push(cmd.data.args);
            if (cmd.data.kwargs !== undefined) {
                msg.push(cmd.data.kwargs);
            }    
        }
        else if (cmd.data.payload !== undefined) {
            let data = JSON.parse(cmd.data.payload);
            if (data instanceof Array) {
                msg.push(data);
            }
            else {
                msg.push([]); // args
                msg.push(data);
            }
        }
        session.send(msg);
    }

    acknowledged(session, cmd) {
        cmdAck[cmd.wtype].call(this, session, cmd);
    }

    wampSendError(session, cmd, requestId, errorCode, args) {
        if (requestId) { // do not send on disconnect
            let wampCode;
            if (errorMessages[errorCode]) {
                wampCode = errorMessages[errorCode];
            }
            else {
                wampCode = errorCode;
            }

            var msg = [WAMP.ERROR, cmd, requestId, {}, wampCode];
            if (args) {
                msg.push(args);
            }

            session.send(msg);
        }
    }
}

class WampHandler extends BaseGate {

    hello(session, realmName, details) {
        session.realmName = realmName;
        if (this.isAuthRequired()) {
            session.secureDetails = details;
            if (details.hasOwnProperty('authmethods') && details.authmethods.indexOf('ticket') >= 0) {
                this.sendChallenge(session, 'ticket', {});
            }
            else {
                this.sendAbort(session, "wamp.error.authorization_failed");
            }
        }
        else {
            this.getRouter().getRealm(realmName, function (realm) {
                realm.joinSession(session);
                var details = this.getRealmDetails(session.realmName);
                details.authmethod = "anonymous";
                this.sendWelcome(session, details);
            }.bind(this));
        }
    }

    authenticate(session, secret) {
        this._authHandler.authenticate(session.realmName, session.secureDetails, secret, function (err) {
            if (err) {
                this.sendAbort(session, "wamp.error.authorization_failed");
            }
            else {
                this.getRouter().getRealm(session.realmName, function (realm) {
                    realm.joinSession(session);
                    var details = this.getRealmDetails(session.realmName);
                    details.authid = session.secureDetails.authid;
                    details.authmethod = "ticket";
                    this.sendWelcome(session, details);
                }.bind(this));
            }
        }.bind(this));
    }

    getRealmDetails(realmName) {
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
    }

    checkRealm(session, requestId) {
        if (!session.realm) {
            throw new RealmError(requestId, "wamp.error.not_authorized");
        }
    }

    sendWelcome(session, details) {
        session.send([WAMP.WELCOME, session.sessionId, details]);
    }

    sendChallenge(session, authmethod) {
        session.send([WAMP.CHALLENGE, authmethod, {}]);
    }

    sendGoodbye(session) {
        // Graceful termination
        var msg = [WAMP.GOODBYE, {}, "wamp.error.goodbye_and_out"];
        session.send(msg, function (error) {
            session.close(1000, "Server closed WAMP session");
        });
    }

    sendAbort(session, reason) {  // auth failed
        var msg = [WAMP.ABORT, {}, reason];
        session.send(msg, function (error) {
            session.close(1000, "Server closed WAMP session");
        });
    }

    handle(session, msg) {
        if (!Array.isArray(msg)) {
            session.close(1003, "protocol violation");
            return;
        }
        var mtype = msg.shift();
        if (!handlers[mtype]) {
            session.close(1003, "protocol violation");
            return;
        }
        try {
            handlers[mtype].call(this, session, msg);
        }
        catch (err) {
            if (err instanceof RealmError) {
                this._encoder.wampSendError(session, mtype, err.requestId, err.code, [err.message]);
            }
            else {
                throw err;
            }
            return;
        }
    }
};

handlers[WAMP.HELLO] = function(session, message) {
    var realmName = message.shift();
    var details = message.shift();
    if (session.realm === null) {
        this.hello(session, realmName, details);
    }
    else {
        session.close(1002, "protocol violation");
    }
    return false;
};

handlers[WAMP.AUTHENTICATE] = function(session, message) {
    var secret = message.shift();
    if (session.realm === null) {
        this.authenticate(session, secret);
    }
    else {
        session.close(1002, "protocol violation");
    }
};

handlers[WAMP.GOODBYE] = function(session, message) {
    this.sendGoodbye(session);
};

handlers[WAMP.REGISTER] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(session, id);
    session.realm.doRegRpc(session, { wtype:WAMP.REGISTER, id, uri, opt });
};

cmdAck[WAMP.REGISTER] = function (session, cmd) {
    session.send([WAMP.REGISTERED, cmd.id, cmd.qid]);
};

handlers[WAMP.CALL] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift() || {};

    this.checkRealm(session, id);
    let cmd = { id, uri, opt, data:{args, kwargs} };

    if (opt && opt.receive_progress) {
        cmd.rsp = RESULT_EMIT;
    }

    session.realm.doCallRpc(session, cmd);
};

handlers[WAMP.UNREGISTER] = function(session, message) {
    var id = message.shift();
    var unr = message.shift();

    this.checkRealm(session, id);
    session.realm.doUnRegRpc(session, { wtype:WAMP.UNREGISTER, id, unr });
};

cmdAck[WAMP.UNREGISTER] = function(session, cmd) {
    if (cmd.id) {  // do not send on disconnect
        session.send([WAMP.UNREGISTERED, cmd.id]);
    }
};

handlers[WAMP.YIELD] = function (session, message) {
    var qid = message.shift();
    var opt = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift();
    this.checkRealm(session, qid);

    let cmd = { qid, data:{args, kwargs}, opt };
    if (opt && opt.progress) {
        cmd.rsp = RESULT_EMIT;
        delete opt.progress;
    }
    else {
        cmd.rsp = RESULT_OK;
    }

    session.realm.doYield(session, cmd);
};

handlers[WAMP.SUBSCRIBE] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(session, id);
    session.realm.doTrace(session, { wtype:WAMP.SUBSCRIBE, id, uri, opt });
};

cmdAck[WAMP.SUBSCRIBE] = function (session, cmd) {
    session.send([WAMP.SUBSCRIBED, cmd.id, cmd.qid]);
};

handlers[WAMP.UNSUBSCRIBE] = function(session, message) {
    let id = message.shift();
    let unr = message.shift();

    this.checkRealm(session, id);
    session.realm.doUnTrace(session, { wtype:WAMP.UNSUBSCRIBE, id, unr });
};

cmdAck[WAMP.UNSUBSCRIBE] = function (session, cmd) {
    if (cmd.id) { // do not send on disconnect
        session.send([WAMP.UNSUBSCRIBED, cmd.id]);
    }
};

handlers[WAMP.PUBLISH] = function(session, message) {
    let id = message.shift();
    let opt = message.shift() || {};
    let uri = message.shift();
    let args = message.shift() || [];
    let kwargs = message.shift() || {};

    let cmd = {
        wtype:WAMP.PUBLISH,
        id,
        uri,
        data:{args, kwargs}
    };

    if (opt.acknowledge) {
        cmd.ack = true;
    }
    delete opt.acknowledge;

    if (false !== opt.exclude_me) {
        opt.exclude_me = true;
    }

    cmd.opt = opt;

    this.checkRealm(session, id);
    session.realm.doPush(session, cmd);
};

cmdAck[WAMP.PUBLISH] = function (session, cmd) {
    session.send([WAMP.PUBLISHED, cmd.id, cmd.qid]);
};

handlers[WAMP.ERROR] = function(session, message) {
    var requestType = message.shift();
    var qid = message.shift();
    var details = message.shift();
    var errorUri = message.shift();   // not used!
    var args = message.shift() || [];
    var kwargs = message.shift();

    // An invocation failed
    this.checkRealm(session, qid);
    if (requestType === WAMP.INVOCATION) {
        session.realm.doYield(session, { qid, err: new Error(details), data:{args, kwargs}});
    }

    return false;
};

exports.WampHandler = WampHandler;
exports.WampEncoder = WampEncoder;
