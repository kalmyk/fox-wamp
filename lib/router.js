/*jshint node: true */
/*jshint esversion: 6 */
'use strict';

var
  MSG = require('./messages'),
  tools = require('./tools'),
  Realm = require('./realm'),
  util  = require('util'),
  EventEmitter = require('events').EventEmitter;

var trace = function () {};

if ('WAMPRT_TRACE' in global && WAMPRT_TRACE && 'console' in global) {  // jshint ignore:line
  trace = function () {
    console.log.apply(console, arguments);
  };
}

util.inherits(Router, EventEmitter);

function Router() {
  // Realm management
  var _realms = new Map();
  EventEmitter.call(this);

  // authHandler.authenticate(realmName, secureDetails, secret, callback)
  let authHandler;

  this.setAuthHandler = function(auth) {
    authHandler = auth;
  };

  this.isAuthRequired = function() {
    return (typeof authHandler !== 'undefined');
  };

  this.authenticate = function (realmName, secureDetails, secret, callback) {
    return authHandler.authenticate(realmName, secureDetails, secret, callback);
  };

  this.getRealm = function(realmName, callback) {
    if (_realms.has(realmName)) {
      callback(_realms.get(realmName));
    } else {
      var realm = new Realm(this, realmName);
      _realms.set(realmName, realm);
      this.emit(MSG.REALM_CREATED, realm, realmName);
      callback(realm);
    }
  };

  this.makeSessionId = function () {
    return tools.randomId();
  };

  this.registerSession = function (session) {
    this.emit('connection', session);
  };

  this.on('session.Tx', function (session, data) {
    trace("["+session.sessionId+"] TX > "+data);
  });

  this.on('session.Rx', function (session, data) {
    trace("["+session.sessionId+"] RX > "+data);
  });

  this.on('session.debug', function (session, msg) {
    trace("["+session.sessionId+"] "+msg);
  });

  this.on('session.warning', function (session, msg, data) {
    trace("["+session.sessionId+"] "+msg+' '+data);
  });
}

module.exports = Router;
