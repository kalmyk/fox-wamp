/*jshint node: true */
'use strict';

var
  net = require('net'),
  generate    = require('mqtt-packet').generate,
  ParserBuild = require('mqtt-packet').parser;

function MqttSender(socket) {
    this.send = function (msg) {
        socket.write(generate(msg));
    };

    this.close = function (code, reason) {
        socket.end();
    };
}

function MqttServer(gate, SessionClass, options) {

    let sessionList = undefined;

    let _server = net.Server(function (socket) {
        var sender = new MqttSender(socket);
        var session = new SessionClass(gate, sender, gate.makeSessionId());

        if (sessionList) {
            sessionList.registerSession(session);
        }

        let parser = ParserBuild();

        parser.on('packet', function(msg) {
            console.log('PACKET ARRIVED', msg);
            session.handle(msg);
        });

        socket.on('data', function(chunk) {
            parser.parse(chunk);
        });

        socket.on('end', function() {
        });

        socket.on('close', function() {
            if (sessionList) {
                sessionList.removeSession(session);
            }
            session.cleanup();
        });
    });
    _server.listen(options);

    this.setSessionList = function(list) {
        sessionList = list;
    };
}

module.exports = MqttServer;

