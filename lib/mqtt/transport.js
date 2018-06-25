/*jshint node: true */
'use strict';

var
  net = require('net'),
  generate    = require('mqtt-packet').generate,
  ParserBuild = require('mqtt-packet').parser;

function NetParser(socket, session, gate) {
  var parser = ParserBuild();

  parser.on('packet', function(msg) {
console.log('PACKET ARRIVED', msg);
    gate.handle(session, msg);
  });

  socket.on('data', function(chunk) {
    parser.parse(chunk);
  });

  socket.on('end', function() {
  });

  socket.on('close', function() {
    gate.cleanupSession(session);
  });
}

function NetSender(socket) {
    this.send = function (msg) {
        socket.write(generate(msg));
    };

    this.close = function (code, reason) {
        socket.end();
    };
}

function NetServer(gate, SessionClass, options) {
  var _server = net.Server(function (socket) {
    var sender = new NetSender(socket);
    var session = new SessionClass(gate, sender, gate.makeSessionId());
    gate.registerSession(session);
    var parser = new NetParser(socket, session, gate);
  });
  _server.listen(options);
}

exports.Server = NetServer;
exports.Sender = NetSender;
exports.Parser = NetParser;
