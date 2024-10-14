'use strict'

const { errorCodes } = require('./realm_error')

class BaseGate {
  constructor (router) {
    this._router = router
    this._authHandler = undefined
    this._authMethods = []
  }

  // authHandler.authTicket(realmName, secureDetails, secret, callback)
  setAuthHandler (authHandler) {
    this._authHandler = authHandler
    if (typeof authHandler.getAuthMethods === 'function') {
      this._authMethods = authHandler.getAuthMethods()
    }
  }

  getAcceptedAuthMethod (methods) {
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

  checkAuthorize (ctx, cmd, funcClass) {
    if (this.isAuthorizeRequired() &&
      !this._authHandler.authorize(ctx.getSession(), funcClass, cmd.uri))
    {
      ctx.sendError(cmd, errorCodes.ERROR_AUTHORIZATION_FAILED)
      return false
    }
    return true
  }

  getRouter () {
    return this._router
  }
}

module.exports = BaseGate
