/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
    QUEUE = require('./const.js'),
    {RESULT_OK, RESULT_ACK, RESULT_ERR} = require('../messages'),
    BaseGate = require('../base_gate'),
    RealmError = require('../realm_error').RealmError;

var handlers = {};

class FoxGate extends BaseGate {

    checkHeader(index) {
        if (this.msg.hasOwnProperty(index))
        return true;
    
        this.reject(
            QUEUE.ERROR_HEADER_IS_NOT_COMPLETED,
            'Header is not completed "'+index+'"'
        );

        return false;
    }

    checkRealm(session, requestId) {
        if (!session.realm) {
            throw new RealmError(requestId, "wamp.error.not_authorized");
        }
    }

    sendWelcome(session, cmd) {
        session.send({
            id:cmd.id,
            rsp:RESULT_OK
        });
    }

    sendInvoke(session, cmd) {
        let msg = {};
        msg.id = cmd.id;
        msg.uri = cmd.uri;
        msg.qid = cmd.qid;
        msg.opt = cmd.opt;
        msg.rsp = QUEUE.RES_TASK;
        msg.data = cmd.data;
        session.send(msg);
    }

    sendEvent(session, cmd) {
        let msg = {};
        msg.id = cmd.id;
        msg.uri = cmd.uri;
        msg.qid = cmd.qid;
        msg.opt = cmd.opt;
        msg.rsp = QUEUE.RES_EVENT;
        msg.data = cmd.data;
        session.send(msg);
    }

    sendResult(session, cmd) {
        let msg = {};
        msg.id = cmd.id;
        msg.rsp = cmd.rsp;
        msg.data = cmd.data;
        session.send(msg);
    }

    acknowledged(session, cmd) {
        let msg = {};
        msg.id = cmd.id;
        msg.ft = cmd.ft;
        if (cmd.qid) {              // REG + TRACE
            msg.rsp = RESULT_ACK;
            msg.data = cmd.qid;     // will unregister
        }
        else {                      // UNREG + UNTRACE + PUSH
            msg.rsp = RESULT_OK;
            if (cmd.data) {
                msg.data = cmd.data;
            }
        }
        session.send(msg);
    }

    foxSendError(session, foxType, requestId, errCode, errMessage) {
        let msg = {};
        msg.id = requestId;
        msg.rsp = RESULT_ERR;
        msg.ft = foxType;
        msg.data = {code:errCode,message:errMessage};
        session.send(msg);
    }

    handle(session, msg) {
        if (typeof msg !== 'object') {
            session.close(1003, "protocol violation");
            return;
        }
        let foxType = msg.ft;
        if (!handlers[foxType]) {
            console.log('Type Not Found', msg);
            session.close(1003, "protocol violation");
            return;
        }
        try {
            handlers[foxType].call(this, session, msg);
        }
        catch (err) {
            if (err instanceof RealmError) {
                this.foxSendError(session, foxType, err.requestId, err.code, err.message);
            }
            else {
                console.log('hyper-gate-error', foxType, err);
                throw err;
            }
        }
    }
};

handlers.LOGIN = function(session, message) {
    this.loginRealm(session, message);
};

handlers.ECHO = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doEcho(session, message);
};

handlers.YIELD = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doYield(session, message);
};

handlers.CONFIRM = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doConfirm(session, message);
};

handlers.REG = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doRegRpc(session, message);
};

handlers.UNREG = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doUnRegRpc(session, message);
};

handlers.CALL = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doCallRpc(session, message);
};

handlers.TRACE = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doTrace(session, message);
};

handlers.UNTRACE = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doUnTrace(session, message);
};

handlers.PUSH = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doPush(session, message);
};

handlers.GOODBYE = function(session, message) {
    session.close(1000, "Server closed session");
};

module.exports = FoxGate;
