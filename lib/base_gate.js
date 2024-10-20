'use strict'

const { errorCodes } = require('./realm_error')

/*
  data types
    - payload: Buffer(): 'base64' comes from MQTT
    - kv: key/value hyper
    - args: array, if length is one, take the item, comes from WAMP
*/

function getBodyValue (body) {
  if (body === null || body === undefined) {
    return null
  }
  if (typeof body === 'object') {
    if ('kv' in body)      return body.kv
    if ('payload' in body) return JSON.parse(body.payload)
    if ('args' in body)    return Array.isArray(body.args) && body.args.length == 1 ? body.args[0] : body.args
  }
  throw new Error('unknown body `' + JSON.stringify(body) + '`')
}

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

exports.BaseGate = BaseGate
exports.getBodyValue = getBodyValue
