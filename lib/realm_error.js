/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

class RealmError extends Error {
    constructor(requestId, message, args) {
        super(message);
        this.requestId = requestId;
        this.args = args;
    }
}

module.exports.RealmError = RealmError;
