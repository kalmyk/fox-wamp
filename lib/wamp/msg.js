'use strict'

const { errorCodes } = require('../realm_error')

const errorMessages = {}

// A Dealer could not perform a call, since not procedure is currently registered under the given URI.
errorMessages[errorCodes.ERROR_NO_SUCH_PROCEDURE] = 'wamp.error.no_such_procedure'

// A Dealer could not perform a unregister, since the given registration is not active.
errorMessages[errorCodes.ERROR_NO_SUCH_REGISTRATION] = 'wamp.error.no_such_registration'

errorMessages[errorCodes.ERROR_AUTHORIZATION_FAILED] = 'wamp.error.authorization_failed'
errorMessages[errorCodes.ERROR_NOT_AUTHORIZED] = 'wamp.error.not_authorized'
errorMessages[errorCodes.ERROR_INVALID_PAYLOAD] = 'wamp.error.invalid_payload'
errorMessages[errorCodes.ERROR_INVALID_URI] = 'wamp.error.invalid_uri'
errorMessages[errorCodes.ERROR_INVALID_ARGUMENT] = 'wamp.error.invalid_argument'
errorMessages[errorCodes.ERROR_CALLEE_FAILURE] = 'wamp.error.callee_failure'

// wamp.error.authentication_failed
// wamp.error.no_such_role
// wamp.error.no_such_realm
// wamp.error.no_auth_method

exports.errorMessages = errorMessages

exports.wampCode = function (errorCode) {
  return errorMessages[errorCode] ? errorMessages[errorCode] : errorCode
}
