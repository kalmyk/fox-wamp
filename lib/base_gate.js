'use strict'

const RealmError = require('./realm_error').RealmError
const errorCodes = require('./realm_error').errorCodes

class BaseGate {
  constructor (router, encoder) {
    this._router = router
    this._authHandler = undefined
    this._encoder = encoder || this
  }

  // authHandler.authTicket(realmName, secureDetails, secret, callback)
  setAuthHandler (auth) {
    this._authHandler = auth
  }

  isAuthRequired () {
    return (typeof this._authHandler !== 'undefined')
  }

  isAuthorizeRequired () {
    return (typeof this._authHandler !== 'undefined' && typeof this._authHandler.authorize === 'function')
  }

  checkAuthorize (ctx, funcClass, uri) {
    if (this.isAuthorizeRequired() && !this._authHandler.authorize(ctx.getSession(), funcClass, uri)) {
      throw new RealmError(ctx.getId(), errorCodes.ERROR_AUTHORIZATION_FAILED)
    }
  }

  makeSessionId () {
    return this._router.makeSessionId()
  }

  getEncoder () {
    return this._encoder
  }

  getRouter () {
    return this._router
  }
}

module.exports = BaseGate
