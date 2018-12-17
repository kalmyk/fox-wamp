/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    {RESULT_OK, RESULT_ACK, RESULT_ERR,
     REQUEST_EVENT, REQUEST_TASK} = require('../messages'),
    BaseGate = require('../base_gate'),
    errorCodes = require('../realm_error').errorCodes,
    RealmError = require('../realm_error').RealmError;

let handlers = {},
    cmdAck   = {};

class FoxGate extends BaseGate {

    checkHeader(index) {
        if (this.msg.hasOwnProperty(index))
            return true;
    
        this.reject(
            errorCodes.ERROR_HEADER_IS_NOT_COMPLETED,
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
        msg.rsp = REQUEST_TASK;
        msg.data = cmd.data;
        session.send(msg);
    }

    sendEvent(session, cmd) {
        let msg = {};
        msg.id = cmd.id;
        msg.uri = cmd.uri;
        msg.qid = cmd.qid;
        msg.opt = cmd.opt;
        msg.rsp = REQUEST_EVENT;
        msg.data = cmd.data;
        session.send(msg);
    }

    sendResult(session, cmd) {
        session.send({
            id: cmd.id,
            rsp: cmd.rsp,
            data: cmd.data
        });
    }

    acknowledged(session, cmd) {
        cmdAck[cmd.ft].call(this, session, cmd);
    }

    foxSendError(session, foxType, requestId, errCode, errMessage) {
        session.send({
            id: requestId,
            ft: foxType,
            rsp: RESULT_ERR,
            data: {code:errCode,message:errMessage}
        });
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

cmdAck.ECHO = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_OK,
        data: cmd.data
    });
};

handlers.YIELD = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doYield(session, message);
};

handlers.CONFIRM = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doConfirm(session, message);
};

cmdAck.CONFIRM = function (session, cmd) {
    session.send({
        id: cmd.id,
        qid: cmd.qid,
        rsp: RESULT_OK,
        data: cmd.data
    });
};

handlers.REG = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doRegRpc(session, message);
};

cmdAck.REG = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_ACK,
        data: {kv:cmd.qid}     // will unregister
    });
};

handlers.UNREG = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doUnRegRpc(session, message);
};

cmdAck.UNREG = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_OK
    });
};

handlers.CALL = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doCallRpc(session, message);
};

handlers.TRACE = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doTrace(session, message);
};

cmdAck.TRACE = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_ACK,
        data: {kv:cmd.qid}     // will unregister
    });
};

handlers.UNTRACE = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doUnTrace(session, message);
};

cmdAck.UNTRACE = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_OK
    });
};

handlers.PUSH = function(session, message) {
    this.checkRealm(session, message.id);
    session.realm.doPush(session, message);
};

cmdAck.PUSH = function (session, cmd) {
    session.send({
        id: cmd.id,
        rsp: RESULT_OK,
        data: cmd.data
    });
};

handlers.GOODBYE = function(session, message) {
    session.close(1000, "Server closed session");
};

module.exports = FoxGate;
