/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
  WAMP = require('./protocol'),
  RealmError = require('./realm_error').RealmError;

var handlers = {},
    cmdAck   = {};

var Facade = function () {
    this.checkRealm = function (requestId) {
        if (!this.realm) {
            throw new RealmError(requestId, "wamp.error.not_authorized");
        }
    };
    this.sendWelcome = function (details) {
        this.send([WAMP.WELCOME, this.sessionId, details]);
    };
    this.sendChallenge = function (authmethod) {
        this.send([WAMP.CHALLENGE, authmethod, {}]);
    };
    this.sendInvoke = function (regId, invId, args, kwargs, opt) {
        var msg = [
            WAMP.INVOCATION,
            invId,
            regId,
            opt,
        ];
        if (undefined !== args)   msg.push(args);
        if (undefined !== kwargs) msg.push(kwargs);
        this.send(msg);
    };
    this.sendResult = function (invId, err, args, kwargs, opt) {
        if (err) {
            this.sendError(WAMP.CALL, invId, "wamp.error.callee_failure");
        }
        else {
            var msg =  [
                WAMP.RESULT,
                invId,
                opt,
            ];
            if (undefined !== args)   msg.push(args);
            if (undefined !== kwargs) msg.push(kwargs);
            this.send(msg);
        }
    };
    this.sendEvent = function (subscriptionId, publicationId, args, kwargs, eventOpts) {
        var msg = [
            WAMP.EVENT,
            subscriptionId,
            publicationId,
            eventOpts
        ];
        // Manage optional parameters args + kwargs
        if (args !== undefined) {
            msg.push(args);
        }
        if (kwargs !== undefined) {
            msg.push(kwargs);
        }
        this.send(msg);
    };
    this.sendError = function (cmd, requestId, txt, args) {
        if (requestId) { // do not send on disconnect
            var msg = [WAMP.ERROR, cmd, requestId, {}, txt];
            if (args)
                msg.push(args);
            this.send(msg);
        }
    };
    this.sendGoodbye = function () {
        // Graceful termination
        var msg = [WAMP.GOODBYE, {}, "wamp.error.goodbye_and_out"];
        this.send(msg, function (error) {
            this.terminate(1000, "Server closed WAMP session");
        }.bind(this));
    };
    this.sendAbort = function (reason) {  // auth failed
        var msg = [WAMP.ABORT, {}, reason];
        this.send(msg, function (error) {
            this.terminate(1000, "Server closed WAMP session");
        }.bind(this));
    };
    this.handle = function (msg) {
        if (!Array.isArray(msg)) {
            this.terminate(1003, "protocol violation");
            return;
        }
        var mtype = msg.shift();
        if (!handlers[mtype]) {
            this.terminate(1003, "protocol violation");
            return;
        }
        try {
            let cmd = handlers[mtype].call(this, msg);
            if (cmd) {
                cmd.mtype = mtype;
                this.realm.handle(this, cmd);
            }
        }
        catch (err) {
            if (err instanceof RealmError) {
                this.sendError(mtype, err.requestId, err.message, err.args);
            }
            else {
                throw err;
            }
            return;
        }
    };
    this.acknowledged = function(cmd) {
        cmdAck[cmd.mtype].call(this, cmd);
    };
};

// This handlers are meant to be called in the context of the SESSION object

handlers[WAMP.HELLO] = function(message) {
    var realmName = message.shift();
    var details = message.shift();
    if (this.realm === null) {
        this.hello(realmName, details);
    } else {
        this.terminate(1002, "protocol violation");
    }
    return false;
};

handlers[WAMP.AUTHENTICATE] = function(message) {
    var secret = message.shift();
    if (this.realm === null) {
        this.authenticate(secret);
    } else {
        this.terminate(1002, "protocol violation");
    }
    return false;
};

handlers[WAMP.GOODBYE] = function(message) {
    this.sendGoodbye();
    return false;
};

handlers[WAMP.REGISTER] = function (message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(id);
    return { id, uri, opt };
};

cmdAck[WAMP.REGISTER] = function (cmd) {
    this.send([WAMP.REGISTERED, cmd.id, cmd.qid]);
};

handlers[WAMP.CALL] = function (message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift() || {};

    this.checkRealm(id);
    return { id, uri, opt, args, kwargs };
};

handlers[WAMP.UNREGISTER] = function (message) {
    var id = message.shift();
    var qid = message.shift();

    this.checkRealm(id);
    return { id, qid };
};

cmdAck[WAMP.UNREGISTER] = function (cmd) {
    if (cmd.id)  // do not send on disconnect
        this.send([WAMP.UNREGISTERED, cmd.id]);
};

handlers[WAMP.YIELD] = function (message) {
    var id = message.shift();
    var opt = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift();
    this.checkRealm(id);

    return { id, args, kwargs, opt };
};

handlers[WAMP.SUBSCRIBE] = function(message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();

    this.checkRealm(id);
    return { id, uri, opt };
};

cmdAck[WAMP.SUBSCRIBE] = function (cmd) {
    this.send([WAMP.SUBSCRIBED, cmd.id, cmd.qid]);
};

handlers[WAMP.UNSUBSCRIBE] = function(message) {
    var id = message.shift();
    var qid = message.shift();

    this.checkRealm(id);
    return { id, qid };
};

cmdAck[WAMP.UNSUBSCRIBE] = function (cmd) {
    if (cmd.id)  // do not send on disconnect
        this.send([WAMP.UNSUBSCRIBED, cmd.id]);
};

handlers[WAMP.PUBLISH] = function(message) {
    var id = message.shift();
    var opt = message.shift();
    var uri = message.shift();
    var args = message.shift() || [];
    var kwargs = message.shift() || {};

    this.checkRealm(id);
    return { id, uri, opt, args, kwargs };
};

cmdAck[WAMP.PUBLISH] = function (cmd) {
    this.send([WAMP.PUBLISHED, cmd.id, cmd.qid]);
};

handlers[WAMP.ERROR] = function(message) {
    var requestType = message.shift();
    var id = message.shift();
    var details = message.shift();
    var errorUri = message.shift();   // not used!
    var args = message.shift() || [];
    var kwargs = message.shift();

    // An invocation failed
    this.checkRealm(id);
    if (requestType === WAMP.INVOCATION)
        return { id, err: new Error(details), args, kwargs };

    return false;
};

module.exports = Facade;
