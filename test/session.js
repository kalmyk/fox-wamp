'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const WAMP      = require('../lib/wamp/protocol')
const WampGate  = require('../lib/wamp/gate')
const FoxRouter = require('../lib/fox_router')

chai.use(spies)

describe('wamp-session', function () {
  var
    sessionId,
    router,
    gate,
    sender,
    ctx,
    cli

  beforeEach(function () {
    sender = {}
    router = new FoxRouter()
    gate = new WampGate.WampHandler(router, new WampGate.WampEncoder())
    ctx = router.newContext()
    cli = router.newSession(gate, sender)
    sessionId = cli.sessionId
  })

  afterEach(function () {
  })

  it('HELLO/WELCOME', function () {
    sender.send = chai.spy(
      function (msg, callback) {
        expect(msg[0]).to.equal(WAMP.WELCOME)
        expect(msg[1]).to.equal(sessionId)
        // console.log(msg[2].roles)
      }
    )
    cli.handle(ctx, [WAMP.HELLO, 'test', {}])
    expect(sender.send).to.have.been.called.once()

    // second hello command raises error and disconnects the user
    sender.send = chai.spy(function (msg, callback) {})
    sender.close = chai.spy(function (error, reason) {})
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
    sender.close = chai.spy(
      function (error) {}
    )
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
