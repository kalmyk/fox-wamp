var
    inherits  = require('util').inherits,
    metaUser  = require('../ext/metauser'),
    Session   = require('./session'),
    Transport = require('./transport'),
    Router    = require('./router');

RouterTransport = function (options, auth) {
    Router.call(this);

    var _options = options || {};

    if ( !_options.disableProtocolCheck ) {
        // We need to verify that the subprotocol is wamp.2.json
        _options.handleProtocols = function (protocols, request) {
            var i=0;
            while(i < protocols.length) {
                if (protocols[i] == "wamp.2.json")
                    return "wamp.2.json";
                i++;
            }
        };
    }
    _transport = new Transport(this, auth, Session, _options);
    metaUser.registerHandlers(this);
};

inherits(RouterTransport, Router);
module.exports = RouterTransport;
