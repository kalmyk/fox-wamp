'use strict'

const RealmError = require('./realm_error').RealmError
const errorCodes = require('./realm_error').errorCodes
const Session = require('./session')

class BaseGate {
  constructor (router) {
    this._router = router
    this._authHandler = undefined
    this._sessions = undefined
    this._authMethods = []
  }

  // authHandler.authTicket(realmName, secureDetails, secret, callback)
  setAuthHandler (authHandler) {
    this._authHandler = authHandler
    if (typeof authHandler.getAuthMethods === 'function') {
      this._authMethods = authHandler.getAuthMethods()
    }
  }

  getAcceptedAuthMethod(methods) {
    for (let i = 0; i < this._authMethods.length; i++) {
      if (methods.includes(this._authMethods[i])) {
        return this._authMethods[i]
      }
    }
    return undefined
  }

  isAuthRequired (session) {
    return (typeof this._authHandler !== 'undefined')
  }

  isAuthorizeRequired () {
    return (typeof this._authHandler !== 'undefined' && typeof this._authHandler.authorize === 'function')
  }

  checkAuthorize (ctx, funcClass, uri, id) {
    if (this.isAuthorizeRequired() && !this._authHandler.authorize(ctx.getSession(), funcClass, uri)) {
      ctx.error(id, errorCodes.ERROR_AUTHORIZATION_FAILED)
      return false
    }
    return true
  }

  createSession () {
    let session = new Session(this, this._router.makeSessionId())
    this.registerSession(session)
    return session
  }

  getRouter () {
    return this._router
  }

  registerSession (session) {
    return this._router.registerSession(session)
  }

  removeSession (session) {
    return this._router.removeSession(session)
  }
}

module.exports = BaseGate
