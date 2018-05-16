/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

let
  WebSocket = require('ws');

module.exports = Transport;

function WsParser(wsclient, router, session) {
    wsclient.on('message', function(data) {
        var msg;
        try {
            router.emit('session.Rx', session, data);
            msg = JSON.parse(data);
            session.handle(msg);
        }
        catch (e) {
            router.emit('session.warning', session, 'invalid json', data);
            session.terminate(1003, "protocol violation");
            return;
        }
    });

    wsclient.on('close', function() {
        session.cleanup();
    });
}

function WsSender(wsclient, router) {
    let session;

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

function Transport(router, SessionClass, wsOptions) {
    var _wss = new WebSocket.Server(wsOptions);
    // Create a Session object for the lifetime of each
    // WebSocket client object
    _wss.on('connection', function (wsclient) {
        var sender = new WsSender(wsclient, router);
        var session = new SessionClass(router, sender, router.makeSessionId());
        sender.setSession(session);
        var parser = new WsParser(wsclient, router, session);
        router.registerSession(session);
    });

    this.close = function() {
        _wss.close();
    };
}
