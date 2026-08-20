import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import { FoxGate, FoxSocketWriterContext } from '../lib/hyper/gate.js'
import FoxRouter    from '../lib/fox_router.js'
import { Session }      from '../lib/session.js'

// Auth handler that denies every authentication and every authorization
// attempt, used to prove the gate actually enforces it (regression test
// for GHSA-7c5c-3mv4-xjfq).
class DenyAuth {
  getAuthMethods (): string[] {
    return ['ticket']
  }

  auth (_realmName: string, _secureDetails: any, _secret: any, callback: any): void {
    callback(new Error('denied'))
  }

  authorize (): boolean {
    return false
  }
}

class AllowAuth {
  getAuthMethods (): string[] {
    return ['ticket']
  }

  auth (realmName: string, secureDetails: any, secret: any, callback: any): void {
    if (secret === realmName + '-secret') {
      callback(undefined, { authid: secureDetails.authid })
    } else {
      callback(new Error('authentication_failed'))
    }
  }

  authorize (): boolean {
    return true
  }
}

describe('13.hyper-auth', async () => {
  let
    nextPackagePromise: Array<(value: any) => void>,
    router: FoxRouter,
    gate: FoxGate,
    mockSocket: any,
    ctx: FoxSocketWriterContext,
    cli: Session

  function getNextPackage (): Promise<any> {
    return new Promise((resolve) => {
      nextPackagePromise.push(resolve)
    })
  }

  beforeEach(async () => {
    nextPackagePromise = []
    mockSocket = {
      hyperPkgWrite: (msg: any) => {
        if (nextPackagePromise.length > 0) {
          const promiseResolve = nextPackagePromise.shift() as (value: any) => void
          promiseResolve(msg)
        }
      }
    }
    router = new FoxRouter()
    gate = new FoxGate(router)
    cli = router.createSession()
    ctx = gate.createContext(cli, mockSocket)
  })

  it('LOGIN without an auth handler joins the realm (no auth configured)', async () => {
    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1' } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('OK')
    expect(cli.realm).to.not.equal(null)
  })

  it('LOGIN is rejected when the configured auth handler denies it', async () => {
    gate.setAuthHandler(new DenyAuth())

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1' } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('ERR')
    expect(cli.realm).to.equal(null)
  })

  it('post-login command is rejected when LOGIN never authenticated (auth denied)', async () => {
    gate.setAuthHandler(new DenyAuth())

    // attacker attempts LOGIN, gets rejected
    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1' } })
    await nextPackage
    expect(cli.realm).to.equal(null)

    // attacker tries to use the session regardless, ECHO must be denied
    nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'ECHO', id: 2, data: { kv: 'after-login-unauthorized' } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('ERR')
  })

  it('LOGIN succeeds and joins the realm when the auth handler accepts the credentials', async () => {
    gate.setAuthHandler(new AllowAuth())

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1', authid: 'joe', secret: 'realm1-secret' } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('OK')
    expect(cli.realm).to.not.equal(null)
    expect(cli.getUserDetails()).to.deep.equal({ authid: 'joe' })
  })

  it('ECHO is rejected by an authorize() that returns false, even for a joined session', async () => {
    const auth = new AllowAuth()
    auth.authorize = () => false
    gate.setAuthHandler(auth)

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1', authid: 'joe', secret: 'realm1-secret' } })
    await nextPackage
    expect(cli.realm).to.not.equal(null)

    nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'ECHO', id: 2, data: { kv: 'should-not-be-echoed' } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('ERR')
  })

  it('CALL is rejected by an authorize() that returns false', async () => {
    const auth = new AllowAuth()
    auth.authorize = () => false
    gate.setAuthHandler(auth)

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1', authid: 'joe', secret: 'realm1-secret' } })
    await nextPackage

    nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'CALL', id: 2, uri: ['some', 'func'], data: { kv: {} } })
    const msg = await nextPackage
    expect(msg.rsp).to.equal('ERR')
  })

  it('a second LOGIN on an already joined session is a protocol violation', async () => {
    gate.setAuthHandler(new AllowAuth())

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 1, data: { realm: 'realm1', authid: 'joe', secret: 'realm1-secret' } })
    await nextPackage

    let writeCalls = 0
    let closeCalls = 0
    mockSocket.hyperPkgWrite = () => { writeCalls++ }
    mockSocket.hyperPkgClose = () => { closeCalls++ }
    gate.handle(ctx, cli, { ft: 'LOGIN', id: 2, data: { realm: 'realm1', authid: 'joe', secret: 'realm1-secret' } })
    expect(writeCalls).to.equal(0)
    expect(closeCalls).to.equal(1)
  })
})
