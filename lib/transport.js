/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
  WebSocket = require('ws');

module.exports = Transport;

function WsParser(wsclient, gate, session) {
    wsclient.on('message', function(data) {
        var msg;
        try {
            gate.emit('session.Rx', session, data);
            msg = JSON.parse(data);
            gate.handle(session, msg);
        }
        catch (e) {
            gate.emit('session.warning', session, 'invalid json', data);
            gate.terminate(session, 1003, "protocol violation");
            return;
        }
    });

    wsclient.on('close', function() {
        gate.cleanupSession(session);
    });
}

function WsSender(wsclient, gate) {
    let session;

    var defaultCallback = function(error) {
        if (error) {
            gate.emit('session.warning', "Failed to send message:", error);
            this.close(1011, "Unexpected error");
        }
    }.bind(this);

    this.setSession = function(sendToSession) {
        session = sendToSession;
    };

    this.send = function(msg, callback) {
        if (wsclient.readyState === WebSocket.OPEN) {
            var data = JSON.stringify(msg);
            gate.emit('session.Tx', session, data);
            wsclient.send(data, (typeof callback === 'function') ?
                          callback : defaultCallback);
        }
    };

    this.close = function (code, reason) {
        gate.emit('session.debug', session, 'Closing WebSocket connection: [' + code + '] ' + reason);
        wsclient.close(code, reason);
    };
}

function Transport(gate, SessionClass, wsOptions) {
    var _wss = new WebSocket.Server(wsOptions);
    // Create a Session object for the lifetime of each
    // WebSocket client object
    _wss.on('connection', function (wsclient) {
        var sender = new WsSender(wsclient, gate);
        var session = new SessionClass(gate, sender, gate.makeSessionId());
        sender.setSession(session);
        var parser = new WsParser(wsclient, gate, session);
        gate.registerSession(session);
    });

    this.close = function() {
        _wss.close();
    };
}
