'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const WAMP      = require('../lib/wamp/protocol')
const WampGate  = require('../lib/wamp/gate')
const FoxRouter = require('../lib/fox_router')

chai.use(spies)

const Auth = function () {
  this.testonly_auth = function (realmName, secureDetails, secret, extra, callback) {
    if (realmName + '-' + secureDetails.authid + '-secret' === secret) {
      callback()
    } else {
      callback('authorization_failed')
    }
  }
  this.testonly_extra = function (realmName, secureDetails, cb) {
    cb(undefined, { serverDefinedExtra: 'the-value' })
  }
  this.getAuthMethods = function () {
    return ['notfound', 'testonly']
  }
}

describe('11 wamp-session', function () {
  var
    router,
    gate,
    mockWampSocket,
    ctx,
    cli

  beforeEach(function () {
    mockWampSocket = {}
    router = new FoxRouter()
    gate = new WampGate(router)
    cli = router.createSession()
    ctx = gate.createContext(cli, mockWampSocket)
  })

  afterEach(function () {
  })

  it('Joe-NOAUTH', function () {
    gate.setAuthHandler(new Auth())
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ABORT)
        expect(msg[2]).to.equal('wamp.error.no_auth_method')
      }
    )
    gate.handle(ctx, cli, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'notexists' ] } ])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()
  })

  it('Joe-AUTH-FAIL', function () {
    gate.setAuthHandler(new Auth())
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('testonly')
      }
    )
    gate.handle(ctx, cli, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'testonly' ] } ])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()

    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ABORT)
        expect(msg[2]).to.equal('wamp.error.authentication_failed')
        // callback()
      }
    )
    gate.handle(ctx, cli, [WAMP.AUTHENTICATE, 'incorrect-secret'])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()
  })

  it ('Joe-AUTH-OK', function () {
    gate.setAuthHandler(new Auth())
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('testonly')
        expect(msg[2]).to.deep.equal({ serverDefinedExtra: 'the-value' })
      }
    )
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', { authid: 'joe', authmethods: ['somecrypto', 'testonly'] }])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()

    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[2].realm).to.equal('test')
        expect(msg[2].authid).to.equal('joe')
        expect(msg[2].authmethod).to.equal('testonly')
      }
    )
    gate.handle(ctx, cli, [WAMP.AUTHENTICATE, 'test-joe-secret'], { extraField: 'some-extra-value' })
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()
  })

  it('HELLO/WELCOME', function () {
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[1]).to.equal(cli.sessionId)
        // console.log(msg[2].roles)
      }
    )
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', {}])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()

    // second hello command raises error and disconnects the user
    mockWampSocket.wampPkgWrite = chai.spy((msg, callback) => {})
    mockWampSocket.wampPkgClose = chai.spy((errObj, reason) => {})
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', {}])
    expect(mockWampSocket.wampPkgWrite).to.not.have.been.called()
    expect(mockWampSocket.wampPkgClose).to.have.been.called.once()
  })

  it('GOODBYE', function () {
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.GOODBYE)
        callback()
      }
    )
    mockWampSocket.wampPkgClose = chai.spy(() => {})
    gate.handle(ctx, cli, [WAMP.GOODBYE])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()
    expect(mockWampSocket.wampPkgClose).to.have.been.called.once()
  })

  it('CALL to no realm RPC', function () {
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ERROR)
        expect(msg[1]).to.equal(WAMP.CALL)
        expect(msg[2]).to.equal(1234)
        expect(msg[4]).to.equal('wamp.error.not_authorized')
      }
    )
    gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'any.function.name', []])
    expect(mockWampSocket.wampPkgWrite).to.have.been.called.once()
  })

  it('REGISTER to no realm', function () {
    mockWampSocket.wampPkgWrite = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ERROR)
        expect(msg[1]).to.equal(WAMP.REGISTER)
        expect(msg[2]).to.equal(1234)
        expect(msg[4]).to.equal('wamp.error.not_authorized')
      }
    )
    gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
    expect(mockWampSocket.wampPkgWrite, 'registration failed').to.have.been.called.once()
  })
})
