'use strict'

let errorCodes = {
  ERROR_DEFER_NOT_FOUND         : 103,
  ERROR_NO_SUCH_PROCEDURE       : 104,
  ERROR_NO_SUCH_REGISTRATION    : 105,

  // body queue error codes
  ERROR_HEADER_IS_NOT_COMPLETED : 107,
  ERROR_AUTHORIZATION_FAILED    : 108,
  ERROR_NOT_AUTHORIZED          : 109,

  ERROR_INVALID_PAYLOAD         : 110,
  ERROR_INVALID_URI             : 111,
  ERROR_INVALID_ARGUMENT        : 112,
  ERROR_CALLEE_FAILURE          : 113
}

class RealmError extends Error {
  constructor (requestId, code, message) {
    super(message)
    this.requestId = requestId
    this.code = code
  }
}

exports.errorCodes = errorCodes
exports.RealmError = RealmError
