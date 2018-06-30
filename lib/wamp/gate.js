/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
  WAMP = require('./protocol'),
  RealmError = require('../realm_error').RealmError;

var handlers = {},
    cmdAck   = {};

var WampGate = function (router) {

    // authHandler.authenticate(realmName, secureDetails, secret, callback)
    let authHandler;
    this.makeSessionId = router.makeSessionId;

    this.emit = function () {
        router.emit.apply(router, arguments);
    };

    this.setAuthHandler = function(auth) {
        authHandler = auth;
    };

    this.isAuthRequired = function() {
        return (typeof authHandler !== 'undefined');
    };

    this.hello = function (session, realmName, details) {
        session.realmName = realmName;
        if (this.isAuthRequired()) {
            session.secureDetails = details;
            if (details.hasOwnProperty('authmethods') && details.authmethods.indexOf('ticket') >= 0) {
                this.sendChallenge(session.sender, 'ticket', {});
            } else {
                this.sendAbort(session.sender, "wamp.error.authorization_failed");
            }
        }
        else {
            router.getRealm(realmName, function (realm) {
                realm.joinSession(session);
                var details = realm.getRealmDetails();
                details.authmethod = "anonymous";
                this.sendWelcome(session, details);
            }.bind(this));
        }
    };

    this.authenticate = function (session, secret) {
        authHandler.authenticate(session.realmName, session.secureDetails, secret, function (err) {
            if (err) {
                this.sendAbort(session.sender, "wamp.error.authorization_failed");
            } else {
                router.getRealm(session.realmName, function (realm) {
                    realm.joinSession(this);
                    var details = realm.getRealmDetails();
                    details.authid = session.secureDetails.authid;
                    details.authmethod = "ticket";
                    this.sendWelcome(session, details);
                }.bind(this));
            }
        }.bind(this));
    };

    this.checkRealm = function (session, requestId) {
        if (!session.realm) {
            throw new RealmError(requestId, "wamp.error.not_authorized");
        }
    };
    this.sendWelcome = function (session, details) {
        session.sender.send([WAMP.WELCOME, session.sessionId, details]);
    };
    this.sendChallenge = function (sender, authmethod) {
        sender.send([WAMP.CHALLENGE, authmethod, {}]);
    };
    this.sendInvoke = function (sender, cmd) {
        let invOpts = {};
        if (cmd.pgs) {
            invOpts.receive_progress = true;
        }
        let msg = [
            WAMP.INVOCATION,
            cmd.id,
            cmd.qid,
            invOpts,
        ];
        if (undefined !== cmd.data.args)   msg.push(cmd.data.args);
        if (undefined !== cmd.data.kwargs) msg.push(cmd.data.kwargs);
        
        sender.send(msg);
    };
    this.sendResult = function (sender, cmd) {
        if (cmd.err) {
            this.sendError(sender, WAMP.CALL, cmd.id, "wamp.error.callee_failure", cmd.data.args);
            return;
        }

        let resOpt = {};
        if (cmd.pgs) {
            resOpt.progress = true;
        }

        var msg =  [
            WAMP.RESULT,
            cmd.id,
            resOpt,
        ];
        if (undefined !== cmd.data.args)   msg.push(cmd.data.args);
        if (undefined !== cmd.data.kwargs) msg.push(cmd.data.kwargs);
        sender.send(msg);
    };
    this.sendEvent = function (sender, cmd) {
        let eventOpt = {
            topic:cmd.uri
        };
        var msg = [
            WAMP.EVENT,
            cmd.qid,
            cmd.id,
            eventOpt
        ];
        // Manage optional parameters args + kwargs
        if (cmd.data.args !== undefined) {
            msg.push(cmd.data.args);
        }
        if (cmd.data.kwargs !== undefined) {
            msg.push(cmd.data.kwargs);
        }
        sender.send(msg);
    };
    this.sendError = function (sender, cmd, requestId, txt, args) {
        if (requestId) { // do not send on disconnect
            var msg = [WAMP.ERROR, cmd, requestId, {}, txt];
            if (args)
                msg.push(args);

            sender.send(msg);
        }
    };
    this.sendGoodbye = function (sender) {
        // Graceful termination
        var msg = [WAMP.GOODBYE, {}, "wamp.error.goodbye_and_out"];
        sender.send(msg, function (error) {
            sender.close(1000, "Server closed WAMP session");
        });
    };
    this.sendAbort = function (sender, reason) {  // auth failed
        var msg = [WAMP.ABORT, {}, reason];
        sender.send(msg, function (error) {
            sender.close(1000, "Server closed WAMP session");
        });
    };
    this.handle = function (session, msg) {
        if (!Array.isArray(msg)) {
            this.terminate(session, 1003, "protocol violation");
            return;
        }
        var mtype = msg.shift();
        if (!handlers[mtype]) {
            this.terminate(session, 1003, "protocol violation");
            return;
        }
        try {
            handlers[mtype].call(this, session, msg);
        }
        catch (err) {
            if (err instanceof RealmError) {
                this.sendError(session.sender, mtype, err.requestId, err.message, err.args);
            }
            else {
                throw err;
            }
            return;
        }
    };
    this.acknowledged = function(sender, cmd) {
        cmdAck[cmd.wtype].call(this, sender, cmd);
    };
    this.terminate = function (session, code, reason) {
        session.sender.close(code, reason);
    };

  this.registerSession = function(session) {
    router.emit('connection', session);
  };

  this.cleanupSession = function(session) {
    router.cleanupSession(session);
  };
};

handlers[WAMP.HELLO] = function(session, message) {
    var realmName = message.shift();
    var details = message.shift();
    if (session.realm === null) {
        this.hello(session, realmName, details);
    } else {
        this.terminate(session, 1002, "protocol violation");
    }
    return false;
};

handlers[WAMP.AUTHENTICATE] = function(session, message) {
    var secret = message.shift();
    if (session.realm === null) {
        this.authenticate(session, secret);
    } else {
        this.terminate(session, 1002, "protocol violation");
    }
};

handlers[WAMP.GOODBYE] = function(session, message) {
    this.sendGoodbye(session.sender);
};

handlers[WAMP.REGISTER] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(session, id);
    session.realm.regrpc(session, { wtype:WAMP.REGISTER, id, uri, opt });
};

cmdAck[WAMP.REGISTER] = function (sender, cmd) {
    sender.send([WAMP.REGISTERED, cmd.id, cmd.qid]);
};

handlers[WAMP.CALL] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift() || {};

    this.checkRealm(session, id);
    let cmd = { id, uri, opt, args, kwargs };

    if (opt && opt.receive_progress) {
        cmd.pgs = true;
    }

    session.realm.callrpc(session, cmd);
};

handlers[WAMP.UNREGISTER] = function(session, message) {
    var id = message.shift();
    var qid = message.shift();

    this.checkRealm(session, id);
    session.realm.unregrpc(session, { wtype:WAMP.UNREGISTER, id, qid });
};

cmdAck[WAMP.UNREGISTER] = function(sender, cmd) {
    if (cmd.id)  // do not send on disconnect
        sender.send([WAMP.UNREGISTERED, cmd.id]);
};

handlers[WAMP.YIELD] = function (session, message) {
    var id = message.shift();
    var opt = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift();
    this.checkRealm(session, id);

    let cmd = { id, data:{args, kwargs}, opt };
    if (opt && opt.progress) {
        cmd.pgs = true;
        delete opt.progress;
    }
    session.realm.resrpc(session, cmd);
};

handlers[WAMP.SUBSCRIBE] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(session, id);
    session.realm.substopic(session, { wtype:WAMP.SUBSCRIBE, id, uri, opt });
};

cmdAck[WAMP.SUBSCRIBE] = function (sender, cmd) {
    sender.send([WAMP.SUBSCRIBED, cmd.id, cmd.qid]);
};

handlers[WAMP.UNSUBSCRIBE] = function(session, message) {
    var id = message.shift();
    var qid = message.shift();

    this.checkRealm(session, id);
    session.realm.unsubstopic(session, { wtype:WAMP.UNSUBSCRIBE, id, qid });
};

cmdAck[WAMP.UNSUBSCRIBE] = function (sender, cmd) {
    if (cmd.id)  // do not send on disconnect
        sender.send([WAMP.UNSUBSCRIBED, cmd.id]);
};

handlers[WAMP.PUBLISH] = function(session, message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift() || {};

    this.checkRealm(session, id);
    session.realm.publish(session, {
        wtype:WAMP.PUBLISH,
        id,
        uri,
        opt,
        data:{args, kwargs}
    });
};

cmdAck[WAMP.PUBLISH] = function (sender, cmd) {
    sender.send([WAMP.PUBLISHED, cmd.id, cmd.qid]);
};

handlers[WAMP.ERROR] = function(session, message) {
    var requestType = message.shift();
    var id = message.shift();
    var details = message.shift();
    var errorUri = message.shift();   // not used!
    var args = message.shift() || [];
    var kwargs = message.shift();

    // An invocation failed
    this.checkRealm(session, id);
    if (requestType === WAMP.INVOCATION) {
        session.realm.resrpc(session, { id, err: new Error(details), data:{args, kwargs}});
    }

    return false;
};

module.exports = WampGate;
