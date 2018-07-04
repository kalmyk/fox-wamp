/*jshint node: true */
'use strict';

var
  net = require('net'),
  msgpack = require('msgpack-lite');

function NetParser(socket, session, gate) {
  var decodeStream = msgpack.createDecodeStream();

  socket.pipe(decodeStream).on('data', function(data) {
    session.handle(data);
  });

  socket.on('end', function() {
  });

  socket.on('close', function() {
    gate.removeSession(session);
  });
}

function NetSender(socket) {
    var encodeStream = msgpack.createEncodeStream();
//    encodeStream.pipe(socket);

    this.send = function (msg, callback) {
        socket.write(msgpack.encode(msg));
//        encodeStream.write(msg);
//        encodeStream.end(); does not sending without end, but disconnections
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

function createSocket(session, gate) {
  var socket = new net.Socket();
  var sender = new NetSender(socket);
  session.sender = sender;
  new NetParser(socket, session, gate);
  return socket;
}

exports.Server = NetServer;
exports.Sender = NetSender;
exports.Parser = NetParser;
exports.createSocket = createSocket;
