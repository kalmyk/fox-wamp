// validate that memory storage has the same results as sqlite
import * as chai from 'chai';
const { expect } = chai;
const assert: Chai.AssertStatic = chai.assert;
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import WAMP            from '../lib/wamp/protocol.js'
import { WampGate }    from '../lib/wamp/gate.js'
import Router          from '../lib/router.js'
import { SqliteKvFabric, SqliteKv }    from '../lib/sqlite/sqlitekv.js'
import { MemEngine }   from '../lib/mono/memengine.js'
import { DbEngine } from '../lib/sqlite/dbengine.js'
import { MemKeyValueStorage } from '../lib/mono/memkv.js'
import { BaseRealm, BaseEngine }   from '../lib/realm.js'
import WampApi         from '../lib/wamp/api.js'
import { getBodyValue } from '../lib/base_gate.js'
import { DbFactory } from '../lib/sqlite/dbfactory.js'
import { keyDate, ProduceId } from '../lib/masterfree/makeid.js'
import Session from '../lib/session.js'
import { HyperClient } from '../lib/hyper/client.js'
import { WampSocketWriterContext } from '../lib/wamp/gate.js'

const TEST_REALM_NAME = 'testrealm'

const makeMemRealm = async (router: Router): Promise<BaseRealm> => {
  let realm = new BaseRealm(router, new MemEngine())
  realm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
  return realm
}

const makeDbRealm = async (router: Router): Promise<BaseRealm> => {
  let db: sqlite.Database = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  const dbFactory = new DbFactory('/tmp/test-fox-wamp.db')
  dbFactory.setMainDb(db)

  let makeId = new ProduceId(() => keyDate(new Date()))
  let modKv = new SqliteKvFabric(dbFactory, makeId)
  let realm = new BaseRealm(router, new DbEngine(makeId, modKv))

  let kv = new SqliteKv(modKv, TEST_REALM_NAME)
  realm.registerKeyValueEngine(['#'], kv)

  return realm
}

const runs = [
  {it: 'mem', mkRealm: makeMemRealm },
  {it: 'db',  mkRealm: makeDbRealm  },
]

describe('55.hyper events', () => {
  runs.forEach((run) => {
    describe('storage:' + run.it, function () {
      let
        router: Router,
        realm: BaseRealm,
        api: HyperClient & { session: () => any },
        mockSocket: any,
        wampGate: WampGate,
        cli: Session,
        ctx: WampSocketWriterContext

      beforeEach(async () => {
        router = new Router()
        realm = await run.mkRealm(router)
        await router.initRealm(TEST_REALM_NAME, realm)       
        api = realm.api()

        mockSocket = { wampPkgWrite: chai.spy(() => {}) }
        wampGate = new WampGate(router)
        cli = router.createSession()
        ctx = wampGate.createContext(cli, mockSocket)
        realm.joinSession(cli)
      })
    
      afterEach(async () => {
        assert.isFalse(cli.hasSendError(), cli.firstSendErrorMessage())
        assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
        cli.cleanup()
        ctx = null as any
      })
  
      it('storage-retain-get:' + run.it, async () => {
        const subSpy = chai.spy(() => {})
        await api.subscribe('topic1', subSpy)
        await api.publish('topic1', { data: 'retain-the-value' }, { retain: true, exclude_me:false })
        await api.publish('topic1', { data: 'the-value-does-not-retain' }, { exclude_me:false })

        let done: (value: unknown) => void
        let resultPromise = new Promise((resolve) => done = resolve as (value: unknown) => void)
        let counter = 2
        let rslt: any[] = []
        mockSocket.wampPkgWrite = chai.spy((msg: any) => {
          rslt.push(msg)
          --counter
          if (counter <= 0) {
            done(undefined as void)
            done = undefined as any
          }
        })
        wampGate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'topic1'])
        await resultPromise

        expect(rslt[0][0]).equal(WAMP.SUBSCRIBED)
        expect(rslt[0][1]).equal(1234)

        expect(rslt[1][0]).equal(WAMP.EVENT)
        expect(rslt[1][3].topic).equal('topic1')
        expect(rslt[1][3].retained).equal(true)
        expect(rslt[1][4]).deep.equal([{ data: 'retain-the-value' }])

        expect(subSpy).called.exactly(2)
      })
  
      it('storage-retain-weak:' + run.it, async () => {
        await api.publish('topic2', ['arg1', 'arg2'], { retain: true, will: null, acknowledge: true })

        let storedValue: any[] = []
        await realm.getKey(['topic2'], (uri, value)=>storedValue.push([uri,value]))
        expect(storedValue).deep.equal([[['topic2'], {kv:['arg1', 'arg2']}]])

        await api.session().cleanup()

        let spyValueNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyValueNotExists)
        expect(spyValueNotExists).not.have.been.called()
      })
  
      it('wamp-key-remove:' + run.it, async () => {
        await api.publish('topic2', { some: 'value' }, { retain: true, acknowledge: true })
        let storedValue: any[] = []
        await realm.getKey(['topic2'], (uri, value)=>storedValue.push([uri,value]))
        expect(storedValue).deep.equal([[['topic2'], {kv:{some:'value'}}]])

        // no kwargs is sent if kwargs passed as null
        await api.publish('topic2', null, { retain: true, acknowledge: true })

        var spyNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyNotExists)

        expect(spyNotExists).not.have.been.called()
      })
  
      // realm must PUSH data if client has disconnect WILL registered
      it('push-will:' + run.it, async () => {
        let events: any[] = []
        await api.subscribe('will.test', event => events.push(event))
    
        const wampApi = new WampApi(realm, router.makeSessionId())
        realm.joinSession(wampApi)
    
        await wampApi.publish(
          'will.test',
          [{ info: 'event-value' }],
          {},
          {
            acknowledge: true,
            trace: true,
            retain: true,
            will: { info: 'will-value' }
          }
        )
        await wampApi.cleanup()
        expect(events.shift()).deep.equal({ info: 'event-value' })
        expect(events.shift()).deep.equal({ args: { info: 'will-value' }})
        assert.equal(0, events.length)
        assert.isFalse(wampApi.hasSendError(), wampApi.firstSendErrorMessage())
      })
    
      it('push-watch-for-push:' + run.it, async () => {
        let events: any[] = []
        await api.subscribe('watch.test', event => events.push(event))

        await api.publish(
          'watch.test',
          { event: 'first event value' },
          {
            trace: true,
            retain: true,
            exclude_me: false,
            acknowledge: true
          }
        )
        expect(events.shift()).deep.equal({ event: 'first event value' })

        const promiseWaitForEmpty = api.publish(
          'watch.test',
          { event: 'second value is set when value empty' },
          {
            trace: true,
            retain: true,
            when: null,
            watch: true,
            exclude_me: false,
            acknowledge: true
          }
        )
    
        await api.publish(
          'watch.test',
          null,
          {
            trace: true,
            retain: true,
            exclude_me: false,
            acknowledge: true 
          }
        )
        expect(events.shift()).deep.equal({ event: 'second value is set when value empty' })

        await promiseWaitForEmpty
        expect(events.shift()).deep.equal(null)

        let storage = []
        await realm.getKey(['watch', 'test'], (uri, value) => {
          storage.push([uri,getBodyValue(value)])
        })
        // TODO: fix-me in db
        // expect(storage).deep.equal([[['watch', 'test'], { event: 'second value is set when value empty' }]])
      })

      it('push-watch-for-will', async () => {
        let defer: any[] = []
        let events: any[] = []
        await api.subscribe('watch.test', event => events.push(event))

        wampGate.handle(ctx, cli, [
          WAMP.PUBLISH,
          123456789,
          {
            retain: true,
            trace: true,
            when: null,
            will: null
          },
          'watch.test',
          [{ event: 'value-1' }],
          {}
        ])

        // TODO: fix-me db
        // defer.push(assert.isRejected(
        api.publish(
          'watch.test',
          { event: 'value-no-watch' },
          {
            retain: true,
            trace: true,
            when: null,
            will: null,
            acknowledge: true
          }
        )
        // ))

        defer.push(assert.isFulfilled(
          api.publish(
            'watch.test',
            { event: 'value-2' },
            {
              retain: true,
              trace: true,
              when: null,
              will: null,
              watch: true,
              acknowledge: true,
              exclude_me: false
            }
          )
        ))
    
        await cli.cleanup()
        await Promise.all(defer)

        expect(events.shift()).deep.equal({ event: 'value-1' })
        expect(events.shift()).deep.equal({ event: 'value-2' }) // ?? move below ?/
        expect(events.shift()).not.exist
        expect(events.length).equal(0)
      })
    
    })
  })
})
