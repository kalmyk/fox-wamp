import * as chai from 'chai'
import promised from 'chai-as-promised'
const assert: Chai.AssertStatic = chai.assert
const { expect } = chai
chai.use(promised)
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'

import { Router } from '../lib/router'
import { BaseEngine, BaseRealm } from '../lib/realm'
import { MemEngine } from '../lib/mono/memengine'
import { MemKeyValueStorage } from '../lib/mono/memkv'
import { DbEngine, SqliteKv } from '../lib/mono/dbengine'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { ProduceId } from '../lib/masterfree/makeid'
import { HyperClient } from '../lib/hyper/client'

const TEST_REALM_NAME = 'testrealm'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type RunConfig = {
  it: string
  mkRealm: (router: Router) => Promise<BaseRealm>
}

class DelayedHistoryEngine extends MemEngine {
  releaseHistory: () => void = () => {}

  override getHistoryAfter(after: any, uri: string[], cbRow: (cmd: any) => void): Promise<void> {
    return super.getHistoryAfter(after, uri, cbRow).then(() => {
      return new Promise(resolve => {
        this.releaseHistory = () => resolve(undefined)
      })
    })
  }
}

const makeMemRealm = async (router: Router, engine: BaseEngine = new MemEngine()): Promise<BaseRealm> => {
  const realm = new BaseRealm(router, engine)
  realm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
  return realm
}

const makeDbRealm = async (router: Router): Promise<BaseRealm> => {
  const db: sqlite.Database = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  const dbFactory = new DbFactory('/tmp/test-fox-wamp.db')
  dbFactory.setMainDb(db)

  const makeId = new ProduceId(() => 'snapshot-test-')
  makeId.actualizePrefix()
  const modKv = new SqliteKvFabric(dbFactory, makeId)
  const engine = new DbEngine(makeId, modKv, { pushLocalEvent () {} })
  const realm = new BaseRealm(router, engine)
  realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, TEST_REALM_NAME, engine))
  return realm
}

const runs: RunConfig[] = [
  { it: 'mem', mkRealm: makeMemRealm },
  { it: 'db', mkRealm: makeDbRealm },
]

describe('71.snapshot-subscription', () => {
  let router: Router
  let realm: BaseRealm
  let api: HyperClient

  afterEach(async () => {
    if (api) {
      assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
      await api.session().cleanup()
    }
  })

  runs.forEach(run => {
    describe('engine:' + run.it, () => {
      beforeEach(async () => {
        router = new Router()
        realm = await run.mkRealm(router)
        await router.initRealm(TEST_REALM_NAME, realm)
        api = realm.api() as HyperClient
      })

      it('returns retained data and terminates the subscription:' + run.it, async () => {
        await api.publish('snapshot.retained', { value: 'stored' }, {
          retain: true,
          acknowledge: true
        })

        const events: any[] = []
        const subId = await api.subscribe('snapshot.retained', event => events.push(event), {
          retained: true,
          snapshot: true
        })

        expect(subId).to.exist
        expect(events).deep.equal([{ value: 'stored' }])

        await api.publish('snapshot.retained', { value: 'live' }, {
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(events).deep.equal([{ value: 'stored' }])
      })

      it('returns history data and terminates the subscription:' + run.it, async () => {
        const startPos = await api.publish('snapshot.history', { value: 'start' }, {
          acknowledge: true,
          trace: true
        })
        await api.publish('snapshot.history', { value: 'history' }, {
          acknowledge: true,
          trace: true
        })

        const events: any[] = []
        await api.subscribe('snapshot.history', event => events.push(event), {
          after: startPos,
          snapshot: true
        })

        expect(events).deep.equal([{ value: 'history' }])
      })

      it('returns history and retained data before resolving:' + run.it, async () => {
        const startPos = await api.publish('snapshot.both', { value: 'start' }, {
          acknowledge: true,
          trace: true
        })
        await api.publish('snapshot.both', { value: 'history' }, {
          acknowledge: true,
          trace: true
        })
        await api.publish('snapshot.both', { value: 'retained' }, {
          acknowledge: true,
          retain: true
        })

        const events: any[] = []
        let callbacksBeforeResolve = false
        await api.subscribe('snapshot.both', event => events.push(event), {
          after: startPos,
          retained: true,
          snapshot: true
        }).then(() => {
          callbacksBeforeResolve = events.length === 2
        })

        expect(events).deep.equal([
          { value: 'history' },
          { value: 'retained' },
        ])
        expect(callbacksBeforeResolve).equal(true)
      })

      it('terminates immediately when there is no snapshot data:' + run.it, async () => {
        const events: any[] = []
        await api.subscribe('snapshot.empty', event => events.push(event), {
          snapshot: true
        })

        await api.publish('snapshot.empty', { value: 'live' }, {
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(events).deep.equal([])
      })
    })
  })

  it('does not deliver live events published during snapshot replay', async () => {
    router = new Router()
    const engine = new DelayedHistoryEngine()
    realm = await makeMemRealm(router, engine)
    await router.initRealm(TEST_REALM_NAME, realm)
    api = realm.api() as HyperClient

    const startPos = await api.publish('snapshot.delay', { value: 'start' }, {
      acknowledge: true,
      trace: true
    })
    await api.publish('snapshot.delay', { value: 'history' }, {
      acknowledge: true,
      trace: true
    })

    const events: any[] = []
    const subscribePromise = api.subscribe('snapshot.delay', event => events.push(event), {
      after: startPos,
      snapshot: true
    })

    await sleep(5)
    await api.publish('snapshot.delay', { value: 'live' }, {
      acknowledge: true,
      exclude_me: false
    })
    engine.releaseHistory()
    await subscribePromise
    await sleep(5)

    expect(events).deep.equal([{ value: 'history' }])
  })

  it('rejects invalid snapshot option values', async () => {
    router = new Router()
    realm = await makeMemRealm(router)
    await router.initRealm(TEST_REALM_NAME, realm)
    api = realm.api() as HyperClient

    await assert.isRejected(
      api.subscribe('snapshot.invalid', () => {}, { snapshot: 'yes' }),
      'snapshot must be a boolean'
    )
  })

  it('rejects snapshot when the engine does not support it', async () => {
    router = new Router()
    const engine = new BaseEngine()
    engine.supportsSnapshotSubscription = false
    realm = await makeMemRealm(router, engine)
    await router.initRealm(TEST_REALM_NAME, realm)
    api = realm.api() as HyperClient

    await assert.isRejected(
      api.subscribe('snapshot.unsupported', () => {}, { snapshot: true }),
      'snapshot subscription is not supported by this engine'
    )
  })
})
