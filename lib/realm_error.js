/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let errorCodes = {
    ERROR_DEFER_NOT_FOUND         : 103,
    ERROR_NO_SUCH_PROCEDURE       : 104
};

class RealmError extends Error {
    constructor(requestId, code, message) {
        super(message);
        this.requestId = requestId;
        this.code = code;
    }
}

exports.errorCodes = errorCodes;
exports.RealmError = RealmError;
