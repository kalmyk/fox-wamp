/*jshint node: true */
'use strict';

var
  MSG = require('../lib/messages');

function registerHandlers(router) {

  router.on(MSG.REALM_CREATED, function (realm, realmName) {
    var api = realm.api();

    api.regrpc('wamp.session.count', function (id, args, kwargs) {
      api.resrpc(id, null /* no error */, [realm.getSessionCount()]);
    });

    api.regrpc('wamp.session.list', function (id, args, kwargs) {
      api.resrpc(id, null /* no error */, realm.getSessionIds());
    });
  });

  router.on(MSG.SESSION_JOIN, function (session, realm) {
    var sessionData = {
      session: session.sessionId
    };
    realm.api().publish('wamp.session.on_join', [], sessionData);
  });

  router.on(MSG.SESSION_LEAVE, function (session, realm) {
    realm.api().publish('wamp.session.on_leave', [session.sessionId]);
  });

/*

wamp.session.count => number
wamp.session.list => [number]
wamp.session.get, [ 43749572799123 ] =>
{ authprovider: 'static',
  authid: '4W3F-HSRV-HRGA-U936-RAK9-CGU9',
  authrole: 'anonymous',
  authmethod: 'anonymous',
  session: 43749572799123,
  transport:
   { cbtid: null,
     protocol: 'wamp.2.json',
     http_headers_received:
      { upgrade: 'websocket',
        'sec-websocket-extensions': 'permessage-deflate; client_max_window_bits',
        'sec-websocket-version': '13',
        'sec-websocket-protocol': 'wamp.2.json',
        host: '127.0.0.1:8080',
        'sec-websocket-key': 'MTMtMTQ5MzI2MTkyMzM2NQ==',
        connection: 'Upgrade' },
     peer: 'tcp4:127.0.0.1:54394',
     http_headers_sent: {},
     websocket_extensions_in_use: [],
     type: 'websocket' } }
*/

}

exports.registerHandlers = registerHandlers;
