/*jshint node: true */
'use strict';

var
  handlers = require('./handlers'),
  inherits = require('util').inherits;

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

function Session (router, sender, sessionId) {
    var secureRealmName;
    var secureDetails;
    this.realm = null;
    this.sessionId = sessionId;
    handlers.call(this);

    this.hello = function (realmName, details) {
        secureRealmName = realmName;
        if (router.isAuthRequired()) {
            secureDetails = details;
            if (details.hasOwnProperty('authmethods') && details.authmethods.indexOf('ticket') >= 0) {
                this.sendChallenge('ticket', {});
            } else {
                this.sendAbort("wamp.error.authorization_failed");
            }
        }
        else {
            router.getRealm(realmName, function (realm) {
                realm.joinSession(this);
                var details = realm.getRealmDetails();
                details.authmethod = "anonymous";
                this.sendWelcome(details);
            }.bind(this));
        }
    };
    this.authenticate = function (secret) {
        router.authenticate(secureRealmName, secureDetails, secret, function (err) {
            if (err) {
                this.sendAbort("wamp.error.authorization_failed");
            } else {
                router.getRealm(secureRealmName, function (realm) {
                    realm.joinSession(this);
                    var details = realm.getRealmDetails();
                    details.authid = secureDetails.authid;
                    details.authmethod = "ticket";
                    this.sendWelcome(details);
                }.bind(this));
            }
        }.bind(this));
    };
    this.send = function (msg, callback) {
        sender.send(msg, callback);
    };
    this.terminate = function (code, reason) {
        sender.close(code, reason);
    };
    this.getRealmName = function() {
        return secureRealmName;
    };
    this.cleanup = function () {
        if (this.realm) {
            this.realm.cleanup(this);
        }
    };
}

module.exports = Session;
inherits(Session, handlers);
