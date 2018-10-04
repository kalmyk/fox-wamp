/*jshint node: true */
'use strict';

var
  net = require('net'),
  generate    = require('mqtt-packet').generate,
  ParserBuild = require('mqtt-packet').parser;

function MqttParser(socket, session, gate) {
  var parser = ParserBuild();

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
    session.cleanup();
  });
}

function MqttSender(socket) {
    this.send = function (msg) {
        socket.write(generate(msg));
    };

    this.close = function (code, reason) {
        socket.end();
    };
}

function MqttServer(gate, SessionClass, options) {
  var _server = net.Server(function (socket) {
    var sender = new MqttSender(socket);
    var session = new SessionClass(gate, sender, gate.makeSessionId());
    gate.registerSession(session);
    var parser = new MqttParser(socket, session, gate);
  });
  _server.listen(options);
}

exports.Server = MqttServer;
exports.Sender = MqttSender;
exports.Parser = MqttParser;
