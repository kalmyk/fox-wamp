/*jshint node: true */
/*jshint esversion: 6 */

var
    MSG         = require('./messages'),
    metaUser    = require('../ext/metauser'),
    Session     = require('./session'),
    Realm       = require('./realm').Realm,
    WampGate    = require('./wamp/gate')
    MqttGate    = require('./mqtt/gate')
    WampServer  = require('./wamp/transport'),
    MqttServer  = require('./mqtt/transport').Server,
    Router      = require('./router');

class FoxRouter extends Router {

    constructor  (authHandler) {
        super();
        this._realms = new Map();
        this._authHandler = authHandler;
        metaUser.registerHandlers(this);
    }

    getRealm(realmName, callback) {
        if (this._realms.has(realmName)) {
            callback(this._realms.get(realmName));
        }
        else {
            let realm = new Realm(this);
            this._realms.set(realmName, realm);
            this.emit(MSG.REALM_CREATED, realm, realmName);
            callback(realm);
        }
    };

    listenWAMP(options) {
        let gate = new WampGate.WampHandler(this, new WampGate.WampEncoder());
        gate.setAuthHandler(this._authHandler);
        return new WampServer(gate, Session, options);
    }

    listenMQTT(options) {
        let gate = new MqttGate(this);
        gate.setAuthHandler(this._authHandler);
        return new MqttServer(gate, Session, options);
    }
};

module.exports = FoxRouter;
