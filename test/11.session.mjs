import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import WAMP         from '../lib/wamp/protocol.js'
import { WampGate } from '../lib/wamp/gate.js'
import FoxRouter    from '../lib/fox_router.js'

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

describe('11 wamp-session', async () => {
  var
    nextPackagePromise,
    router,
    gate,
    mockWampSocket,
    ctx,
    cli

  function getNextPackage() {
    return new Promise((resolve, reject) => {
      nextPackagePromise.push(resolve)
    })
  }

  beforeEach(async () => {
    nextPackagePromise = []
    mockWampSocket = {
      wampPkgWrite: (msg) => {
        if (nextPackagePromise.length > 0) {
          const promiseResolve = nextPackagePromise.shift()
          promiseResolve(msg)
        }
      }
    }
    router = new FoxRouter()
    gate = new WampGate(router)
    cli = router.createSession()
    ctx = gate.createContext(cli, mockWampSocket)
  })

  afterEach(async () => {
  })

  it('Joe-NOAUTH', async () => {
    gate.setAuthHandler(new Auth())

    let nextPackage = getNextPackage()

    gate.handle(ctx, cli, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'notexists' ] } ])

    let msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.ABORT)
    expect(msg[2]).to.equal('wamp.error.no_auth_method')
  })

  it('Joe-AUTH-FAIL', async () => {
    gate.setAuthHandler(new Auth())
    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, [ WAMP.HELLO, 'test', { authid: 'joe', authmethods: [ 'testonly' ] } ])
    let msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.CHALLENGE)
    expect(msg[1]).to.equal('testonly')

    nextPackage = getNextPackage()
    gate.handle(ctx, cli, [WAMP.AUTHENTICATE, 'incorrect-secret'])
    msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.ABORT)
    expect(msg[2]).to.equal('wamp.error.authentication_failed')
  })

  it ('Joe-AUTH-OK', async () => {
    gate.setAuthHandler(new Auth())

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', { authid: 'joe', authmethods: ['somecrypto', 'testonly'] }])
    let msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.CHALLENGE)
    expect(msg[1]).to.equal('testonly')
    expect(msg[2]).to.deep.equal({ serverDefinedExtra: 'the-value' })

    nextPackage = getNextPackage()
    gate.handle(ctx, cli, [WAMP.AUTHENTICATE, 'test-joe-secret'], { extraField: 'some-extra-value' })
    msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.WELCOME)
    expect(msg[2].realm).to.equal('test')
    expect(msg[2].authid).to.equal('joe')
    expect(msg[2].authmethod).to.equal('testonly')
  })

  it('HELLO/WELCOME', async () => {
    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', {}])
    let msg = await nextPackage
    expect(msg[0]).to.equal(WAMP.WELCOME)
    expect(msg[1]).to.equal(cli.sessionId)

    // second hello command raises error and disconnects the user
    mockWampSocket.wampPkgWrite = chai.spy((msg, callback) => {})
    mockWampSocket.wampPkgClose = chai.spy((errObj, reason) => {})
    gate.handle(ctx, cli, [WAMP.HELLO, 'test', {}])
    expect(mockWampSocket.wampPkgWrite).to.not.have.been.called()
    expect(mockWampSocket.wampPkgClose).to.have.been.called.once()
  })

  it('GOODBYE', async () => {
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

  it('CALL to no realm RPC', async () => {
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

  it('REGISTER to no realm', async () => {
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
