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

describe('03. wamp-session', function () {
  var
    router,
    gate,
    sender,
    ctx,
    cli

  beforeEach(function () {
    sender = {}
    router = new FoxRouter()
    gate = new WampGate(router)
    cli = gate.createSession()
    ctx = gate.createContext(cli, sender)
  })

  afterEach(function () {
  })

  it('Joe-NOAUTH', function () {
    gate.setAuthHandler(new Auth())
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ABORT)
        expect(msg[2]).to.equal('wamp.error.no_auth_method')
      }
    )
    cli.handle(ctx, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'notexists' ] } ])
    expect(sender.send).to.have.been.called.once()
  })

  it('Joe-AUTH-FAIL', function () {
    gate.setAuthHandler(new Auth())
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('testonly')
      }
    )
    cli.handle(ctx, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'testonly' ] } ])
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ABORT)
        expect(msg[2]).to.equal('wamp.error.authentication_failed')
        // callback()
      }
    )
    cli.handle(ctx, [WAMP.AUTHENTICATE, 'incorrect-secret'])
    expect(sender.send).to.have.been.called.once()
  })

  it ('Joe-AUTH-OK', function () {
    gate.setAuthHandler(new Auth())
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.CHALLENGE)
        expect(msg[1]).to.equal('testonly')
        expect(msg[2]).to.deep.equal({ serverDefinedExtra: 'the-value' })
      }
    )
    cli.handle(ctx, [WAMP.HELLO, 'test', { authid: 'joe', authmethods: ['somecrypto', 'testonly'] }])
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[2].realm).to.equal('test')
        expect(msg[2].authid).to.equal('joe')
        expect(msg[2].authmethod).to.equal('testonly')
      }
    )
    cli.handle(ctx, [WAMP.AUTHENTICATE, 'test-joe-secret'], { extraField: 'some-extra-value' })
    expect(sender.send).to.have.been.called.once()
  })

  it('HELLO/WELCOME', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[1]).to.equal(cli.sessionId)
        // console.log(msg[2].roles)
      }
    )
    cli.handle(ctx, [WAMP.HELLO, 'test', {}])
    expect(sender.send).to.have.been.called.once()

    // second hello command raises error and disconnects the user
    sender.send = chai.spy((msg, callback) => {})
    sender.close = chai.spy((errObj, reason) => {})
    cli.handle(ctx, [WAMP.HELLO, 'test', {}])
    expect(sender.send).to.not.have.been.called()
    expect(sender.close).to.have.been.called.once()
  })

  it('GOODBYE', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.GOODBYE)
        callback()
      }
    )
    sender.close = chai.spy(() => {})
    cli.handle(ctx, [WAMP.GOODBYE])
    expect(sender.send).to.have.been.called.once()
    expect(sender.close).to.have.been.called.once()
  })

  it('CALL to no realm RPC', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ERROR)
        expect(msg[1]).to.equal(WAMP.CALL)
        expect(msg[2]).to.equal(1234)
        expect(msg[4]).to.equal('wamp.error.not_authorized')
      }
    )
    cli.handle(ctx, [WAMP.CALL, 1234, {}, 'any.function.name', []])
    expect(sender.send).to.have.been.called.once()
  })

  it('REGISTER to no realm', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.ERROR)
        expect(msg[1]).to.equal(WAMP.REGISTER)
        expect(msg[2]).to.equal(1234)
        expect(msg[4]).to.equal('wamp.error.not_authorized')
      }
    )
    cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])
    expect(sender.send, 'registration failed').to.have.been.called.once()
  })
})
