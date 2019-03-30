'use strict'

const chai      = require('chai')
const spies     = require('chai-spies')
const expect    = chai.expect
const WAMP      = require('../lib/wamp/protocol')
const WampGate  = require('../lib/wamp/gate')
const FoxRouter = require('../lib/fox_router')

chai.use(spies)

const Auth = function () {
  this.authenticate = function (realmName, secureDetails, secret, callback) {
    if (realmName + '-' + secureDetails.authid + '-secret' === secret) {
      callback()
    } else {
      callback('authorization_failed')
    }
  }
}

describe('wamp-authenticate', function () {
  let
    router,
    gate,
    sender,
    cli,
    ctx

  beforeEach(function () {
    sender = {}
    router = new FoxRouter()
    gate = new WampGate.WampHandler(router, new WampGate.WampEncoder())
    gate.setAuthHandler(new Auth())

    ctx = router.createContext()
    cli = router.createSession(gate, sender)
  })

  afterEach(function () {
  })

  it('Joe AUTH:FAIL', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('ticket')
      }
    )
    cli.handle(ctx, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'ticket' ] } ])
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ABORT)
        // callback()
      }
    )
    cli.handle(ctx, [WAMP.AUTHENTICATE, 'incorrect-secret'])
    expect(sender.send).to.have.been.called.once()
  })

  it ('Joe AUTH:OK', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('ticket')
      }
    )
    cli.handle(ctx, [WAMP.HELLO, 'test', { authid: 'joe', authmethods: ['ticket'] }])
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[2].realm).to.equal('test')
        expect(msg[2].authid).to.equal('joe')
        expect(msg[2].authmethod).to.equal('ticket')
      }
    )
    cli.handle(ctx, [WAMP.AUTHENTICATE, 'test-joe-secret'])
    expect(sender.send).to.have.been.called.once()
  })
})
