/*jshint node: true */
'use strict';

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

function Session (gate, sender, sessionId) {

    this.realmName;
    this.secureDetails;
    this.realm = null;
    this.gate = gate;
    this.sender = sender;
    this.sessionId = sessionId;

    this.cleanup = function() {
        if (this.realm) {
            this.realm.cleanup(this);
        }
    };
}

module.exports = Session;
