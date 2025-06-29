'use strict'

const MSG = require('../lib/messages')

function registerHandlers (router) {
  router.on(MSG.REALM_CREATED, function (realm, realmName) {
    var api = realm.wampApi()

    api.register('wamp.session.count', function (id, args, kwargs) {
      api.resrpc(id, null /* no error */, [realm.getSessionCount()])
    })

    api.register('wamp.session.list', function (id, args, kwargs) {
      api.resrpc(id, null /* no error */, [realm.getSessionIds()])
    })

    api.register('wamp.session.get', function (id, args, kwargs) {
      if (args instanceof Array && args[0] && typeof args[0] === 'number') {
        api.resrpc(id, null /* no error */, [realm.getSessionInfo(args[0])])
      } else {
        api.resrpc(id, 'unable to get session id')
      }
    })

    realm.on(MSG.SESSION_JOIN, (session) => {
      let sessionData = {
        session: session.getSid(),
        authmethod: session.authmethod,
        transport: {
          protocol: session.getGateProtocol()
        }
      }
      api.publish('wamp.session.on_join', [], sessionData)
    })
  
    realm.on(MSG.SESSION_LEAVE, function (session) {
      api.publish('wamp.session.on_leave', [session.getSid()])
    })  
  })
}

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

exports.registerHandlers = registerHandlers
