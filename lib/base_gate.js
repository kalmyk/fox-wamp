/*jshint node: true */
'use strict';

class BaseGate {

    constructor(router) {
        this._sessions = new Map();
        this._router = router;
        this._authHandler = undefined;
    }

    // authHandler.authenticate(realmName, secureDetails, secret, callback)
    setAuthHandler(auth) {
        this._authHandler = auth;
    }

    isAuthRequired() {
        return (typeof this._authHandler !== 'undefined');
    };

    makeSessionId() {
        return this._router.makeSessionId();
    }

    getRouter() {
        return this._router;
    }

    registerSession(session) {
        if (!this._sessions.has(session.sessionId)) {
            this._sessions.set(session.sessionId, session);
            this._router.emit('connection', session);
        }
        else {
            throw "session id already registered "+session.sessionId;
        }
    }

    getSession(sessionId) {
        return this._sessions.get(sessionId);
    }

    removeSession(session) {
        if (this._sessions.has(session.sessionId)) {
            this._sessions.delete(session.sessionId);
        }
    }
}

module.exports = BaseGate;
