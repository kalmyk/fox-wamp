var
    metaUser    = require('../ext/metauser'),
    Session     = require('./session'),
    WampGate    = require('./wamp/gate')
    MqttGate    = require('./mqtt/gate')
    WampServer  = require('./wamp/transport'),
    MqttServer  = require('./mqtt/transport').Server,
    Router      = require('./router');

class FoxRouter extends Router {

    constructor  (authHandler) {
        super();
        this.authHandler = authHandler;
        metaUser.registerHandlers(this);
    }

    listenWAMP(options) {
        let gate = new WampGate(this);
        gate.setAuthHandler(this.authHandler);
        return new WampServer(gate, Session, options);
    }

    listenMQTT(options) {
        let gate = new MqttGate(this);
        gate.setAuthHandler(this.authHandler);
        return new MqttServer(gate, Session, options);
    }
};

module.exports = FoxRouter;
