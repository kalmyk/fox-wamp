/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
    WebSocket = require('ws');

function WampSender(wsclient, gate) {
    let session;
    let router = gate.getRouter();

    var defaultCallback = function(error) {
        if (error) {
            router.emit('session.warning', "Failed to send message:", error);
            this.close(1011, "Unexpected error");
        }
    }.bind(this);

    this.setSession = function(sendToSession) {
        session = sendToSession;
    };

    this.send = function(msg, callback) {
        if (wsclient.readyState === WebSocket.OPEN) {
            var data = JSON.stringify(msg);
            router.emit('session.Tx', session, data);
            wsclient.send(data, (typeof callback === 'function') ?
                          callback : defaultCallback);
        }
    };

    this.close = function (code, reason) {
        router.emit('session.debug', session, 'Closing WebSocket connection: [' + code + '] ' + reason);
        wsclient.close(code, reason);
    };
}

function WampServer(gate, SessionClass, wsOptions) {
    let router = gate.getRouter();

    if ( !wsOptions.disableProtocolCheck ) {
        // We need to verify that the subprotocol is wamp.2.json
        wsOptions.handleProtocols = function (protocols, request) {
            var i=0;
            while(i < protocols.length) {
                if (protocols[i] == "wamp.2.json")
                    return "wamp.2.json";
                i++;
            }
        };
    }

    var _wss = new WebSocket.Server(wsOptions);

    _wss.on('connection', function (wsclient) {
        var sender = new WampSender(wsclient, gate);
        var session = new SessionClass(gate, sender, gate.makeSessionId());
        sender.setSession(session);

        gate.registerSession(session);

        wsclient.on('close', function() {
            gate.removeSession(session);
            session.cleanup();
        });

        wsclient.on('message', function(data) {
            var msg;
            try {
                router.emit('session.Rx', session, data);
                msg = JSON.parse(data);
                session.handle(msg);
            }
            catch (e) {
                router.emit('session.warning', session, 'invalid json', data);
                gate.terminate(session, 1003, "protocol violation");
                return;
            }
        });

    });

    this.close = function() {
        _wss.close();
    };
}

module.exports = WampServer;
