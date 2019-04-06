'use strict'

const RealmError = require('./realm_error').RealmError
const errorCodes = require('./realm_error').errorCodes

class BaseGate {
  constructor (router) {
    this._router = router
    this._authHandler = undefined
    this._sessions = undefined
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

  getRouter () {
    return this._router
  }

  registerSession (session) {
    if (!this._sessions) {
      return
    }

    if (!this._sessions.has(session.sessionId)) {
      this._sessions.set(session.sessionId, session)
      this._router.emit('connection', session)
    } else {
      throw new Error('session id already registered ' + session.sessionId)
    }
  }

  getSession (sessionId) {
    if (!this._sessions) {
      return null
    }
    return this._sessions.get(sessionId)
  }

  removeSession (session) {
    if (!this._sessions) {
      return null
    }
    if (this._sessions.has(session.sessionId)) {
      this._sessions.delete(session.sessionId)
    }
  }

  setSessionList (list) {
    this._sessions = list
  }
}

module.exports = BaseGate
