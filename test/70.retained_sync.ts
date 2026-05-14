import { assert, expect } from 'chai'
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'
import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { MemEngine } from '../lib/mono/memengine'
import { MemKeyValueStorage } from '../lib/mono/memkv'
import { DbEngine } from '../lib/sqlite/dbengine'
import { ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric, SqliteKv } from '../lib/sqlite/sqlitekv'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { HyperClient } from '../lib/hyper/client'
import { BaseEngine } from '../lib/realm'

const TEST_REALM_NAME = 'testrealm'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

type RunConfig = {
  it: string
  firstRetainedId: string
  secondRetainedId: string
  mkRealm: (router: Router) => Promise<BaseRealm>
}

const makeMemRealm = async (router: Router): Promise<BaseRealm> => {
  const realm = new BaseRealm(router, new MemEngine())
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

  const makeId = new ProduceId(() => 'test-prefix-')
  makeId.actualizePrefix()
  const modKv = new SqliteKvFabric(dbFactory, makeId)
  const realm = new BaseRealm(router, new DbEngine(makeId, modKv))
  realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, TEST_REALM_NAME))
  return realm
}

const runs: RunConfig[] = [
  { it: 'mem', firstRetainedId: '1', secondRetainedId: '2', mkRealm: makeMemRealm },
  { it: 'db', firstRetainedId: 'test-prefix-a1', secondRetainedId: 'test-prefix-a2', mkRealm: makeDbRealm },
]

describe('70.retained-sync', () => {
  runs.forEach(run => {
    describe('engine:' + run.it, () => {
      let router: Router
      let realm: BaseRealm
      let api: HyperClient

      beforeEach(async () => {
        router = new Router()
        realm = await run.mkRealm(router)
        realm.getEngine().retainedEventWaitTimeoutMs = 30
        await router.initRealm(TEST_REALM_NAME, realm)
        api = realm.api() as HyperClient
      })

      afterEach(async () => {
        assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
        await api.session().cleanup()
      })

      it('waits to fetch retained state until event id is committed:' + run.it, async () => {
        const events: any[] = []
        await api.subscribe('sync.topic', event => events.push(event), {
          retained: true,
          after: run.firstRetainedId
        })

        await sleep(5)
        expect(events).deep.equal([])

        await api.publish('sync.topic', { value: 'current' }, {
          retain: true,
          acknowledge: true,
          exclude_me: false
        })

        await sleep(5)
        expect(events).deep.equal([{ value: 'current' }])
      })

      it('fetches retained state immediately if event id is already reached:' + run.it, async () => {
        const eventId = await api.publish('sync.topic', { value: 'stored' }, {
          retain: true,
          acknowledge: true
        })
        const events: any[] = []

        await api.subscribe('sync.topic', event => events.push(event), {
          retained: true,
          after: eventId
        })

        await sleep(5)
        expect(events).deep.equal([{ value: 'stored' }])
      })

      it('multiple waiters on different event ids:' + run.it, async () => {
        const firstEvents: any[] = []
        const secondEvents: any[] = []

        await api.subscribe('sync.topic', event => firstEvents.push(event), {
          retained: true,
          after: run.firstRetainedId
        })
        await api.subscribe('sync.topic', event => secondEvents.push(event), {
          retained: true,
          after: run.secondRetainedId
        })

        await api.publish('sync.topic', { value: 'first' }, {
          retain: true,
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(firstEvents).deep.equal([{ value: 'first' }])
        expect(secondEvents).deep.equal([])

        await api.publish('sync.topic', { value: 'second' }, {
          retain: true,
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(secondEvents).deep.equal([{ value: 'second' }])
      })

      it('waiter remains pending if event is not a retained publish:' + run.it, async () => {
        const events: any[] = []
        await api.subscribe('sync.topic', event => events.push(event), {
          retained: true,
          after: run.firstRetainedId
        })

        const publishPromise = api.publish('sync.topic', { value: 'blocked' }, {
          retain: false,
          acknowledge: true
        })
        const eventId = await publishPromise
        // verify that the non-retained publish reached the requested ID
        expect(realm.getEngine().compareRetainedEventIds(eventId, run.firstRetainedId)).to.be.at.least(0)

        await sleep(5)
        expect(events).deep.equal([])
      })

      it('waiters on multiple topics on different sessions:' + run.it, async () => {
        const apiFirst = realm.api() as HyperClient
        const apiSecond = realm.api() as HyperClient
        const firstEvents: any[] = []
        const secondEvents: any[] = []

        try {
          await apiSecond.subscribe('sync.second', event => secondEvents.push(event), {
            retained: true,
            after: run.secondRetainedId
          })
          await apiFirst.subscribe('sync.first', event => firstEvents.push(event), {
            retained: true,
            after: run.firstRetainedId
          })
          expect(realm.getEngine().pendingRetainedEventWaiters).length(2)

          await api.publish('sync.first', { value: 'first' }, {
            retain: true,
            acknowledge: true
          })
          await sleep(5)
          expect(firstEvents).deep.equal([{ value: 'first' }])
          expect(secondEvents).deep.equal([])

          await api.publish('sync.second', { value: 'second' }, {
            retain: true,
            acknowledge: true
          })
          await sleep(5)
          expect(secondEvents).deep.equal([{ value: 'second' }])
        } finally {
          await apiFirst.session().cleanup()
          await apiSecond.session().cleanup()
        }
      })

      it('cleans pending retained waiter on unsubscribe:' + run.it, async () => {
        const events: any[] = []
        const subId = await api.subscribe('sync.topic', event => events.push(event), {
          retained: true,
          after: run.firstRetainedId
        })
        expect(realm.getEngine().pendingRetainedEventWaiters).length(1)

        await api.unsubscribe(subId)
        expect(realm.getEngine().pendingRetainedEventWaiters).length(0)

        await api.publish('sync.topic', { value: 'ignored' }, {
          retain: true,
          acknowledge: true
        })
        await sleep(5)
        expect(events).deep.equal([])
      })

      it('times out unreachable retained wait and keeps live subscription active:' + run.it, async () => {
        const events: any[] = []
        await api.subscribe('sync.topic', event => events.push(event), {
          retainedState: true,
          after: 'unreachable-id'
        })
        expect(realm.getEngine().pendingRetainedEventWaiters).length(1)

        await sleep(40)
        expect(realm.getEngine().pendingRetainedEventWaiters).length(0)

        await api.publish('sync.topic', { value: 'live' }, {
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(events).deep.equal([{ value: 'live' }])
      })

      it('does not delay live events when after has no retained replay:' + run.it, async () => {
        const events: any[] = []
        await api.subscribe('sync.topic', event => events.push(event), {
          after: 'unreachable-id'
        })

        await api.publish('sync.topic', { value: 'live' }, {
          acknowledge: true,
          exclude_me: false
        })
        await sleep(5)
        expect(events).deep.equal([{ value: 'live' }])
        expect(realm.getEngine().pendingRetainedEventWaiters).length(0)
      })

      it('keeps history replay independent from retained wait:' + run.it, async () => {
        const startPos = await api.publish('sync.topic', { value: 'start' }, {
          acknowledge: true,
          trace: true
        })
        await api.publish('sync.topic', { value: 'history' }, {
          acknowledge: true,
          trace: true
        })

        const events: any[] = []
        await api.subscribe('sync.topic', event => events.push(event), {
          after: startPos,
          retainedState: true
        })
        await sleep(5)
        expect(events).deep.equal([{ value: 'history' }])

        await api.publish('sync.topic', { value: 'retained' }, {
          retain: true,
          acknowledge: true
        })
        await sleep(5)
        expect(events).deep.equal([
          { value: 'history' },
          { value: 'retained' },
        ])
      })
    })
  })

  it('rejects invalid after values', async () => {
    const router = new Router()
    const realm = await makeMemRealm(router)
    await router.initRealm(TEST_REALM_NAME, realm)
    const api = realm.api() as HyperClient

    await assert.isRejected(
      api.subscribe('sync.topic', () => {}, { after: 123 }),
      'after must be a non-empty string'
    )
    await api.session().cleanup()
  })

  it('rejects after when engine does not support retained event sync', async () => {
    const router = new Router()
    const engine = new BaseEngine()
    engine.supportsRetainedEventSync = false
    const realm = new BaseRealm(router, engine)
    await router.initRealm(TEST_REALM_NAME, realm)
    const api = realm.api() as HyperClient

    await assert.isRejected(
      api.subscribe('sync.topic', () => {}, { after: 'remote-event', retained: true }),
      'synchronized retained sync is not supported by this engine'
    )
    await api.session().cleanup()
  })
})
