'use strict';

class BaseGate {

    constructor(router, encoder) {
        this._router = router;
        this._authHandler = undefined;
        this._encoder = encoder || this;
    }

    // authHandler.authenticate(realmName, secureDetails, secret, callback)
    setAuthHandler(auth) {
        this._authHandler = auth;
    }

    isAuthRequired() {
        return (typeof this._authHandler !== 'undefined');
    }

    makeSessionId() {
        return this._router.makeSessionId();
    }

    getEncoder() {
        return this._encoder;
    }

    getRouter() {
        return this._router;
    }
}

module.exports = BaseGate;
