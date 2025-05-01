'use strict'

// validate that memory storage has the same results as sqlite

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const assert      = chai.assert
const promised    = require('chai-as-promised')

const sqlite3     = require('sqlite3')
const sqlite      = require('sqlite')

const WAMP            = require('../lib/wamp/protocol')
const { WampGate }    = require('../lib/wamp/gate')
const Router          = require('../lib/router')
const { SqliteModKv, SqliteKv }    = require('../lib/sqlite/sqlitekv')
const { MemEngine }   = require('../lib/mono/memengine')
const { DbEngine } = require('../lib/sqlite/dbengine')
const { MemKeyValueStorage } = require('../lib/mono/memkv')
const { BaseRealm }   = require('../lib/realm')
const WampApi         = require('../lib/wamp/api')
const { getBodyValue } = require('../lib/base_gate')
const { initDbFactory, getDbFactoryInstance } = require('../lib/sqlite/dbfactory')

chai.use(promised)
chai.use(spies)

const TEST_REALM_NAME = 'testrealm'
initDbFactory()

const makeMemRealm = async (router) => {
  let realm = new BaseRealm(router, new MemEngine())
  realm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
  return realm
}

const makeDbRealm = async (router) => {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  getDbFactoryInstance().setMainDb(db)

  let realm = new BaseRealm(router, new DbEngine())

  let modKv = new SqliteModKv(db)
  await modKv.createTables()

  let kv = new SqliteKv(modKv, getDbFactoryInstance().getMakeId(), TEST_REALM_NAME)
  realm.registerKeyValueEngine(['#'], kv)

  return realm
}

const runs = [
  {it: 'mem', mkRealm: makeMemRealm },
  {it: 'db',  mkRealm: makeDbRealm  },
]

describe('55 hyper events', () => {
  runs.forEach((run) => {
    describe('storage:' + run.it, function () {
      let
        router,
        realm,
        api,
        mockSocket,
        wampGate,
        cli,
        ctx

      beforeEach(async () => {
        router = new Router()
        realm = await run.mkRealm(router)
        await router.initRealm(TEST_REALM_NAME, realm)       
        api = realm.api()

        mockSocket = {}
        wampGate = new WampGate(router)
        cli = router.createSession()
        ctx = wampGate.createContext(cli, mockSocket)
        realm.joinSession(cli)
      })
    
      afterEach(async () => {
        assert.isFalse(cli.hasSendError(), cli.firstSendErrorMessage())
        assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
        cli.cleanup()
        ctx = null
      })
  
      it('storage-retain-get:' + run.it, async () => {
        const subSpy = chai.spy(() => {})
        await api.subscribe('topic1', subSpy)
        await api.publish('topic1', { data: 'retain-the-value' }, { retain: true, exclude_me:false })
        await api.publish('topic1', { data: 'the-value-does-not-retain' }, { exclude_me:false })

        let done
        let resultPromise = new Promise((resolve) => done = resolve)
        let counter = 2
        let rslt = []
        mockSocket.wampPkgWrite = chai.spy((msg) => {
          rslt.push(msg)
          --counter
          if (counter <= 0) {
            done()
            done = undefined
          }
        })
        wampGate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'topic1'])
        await resultPromise

        expect(rslt[0][0]).to.equal(WAMP.SUBSCRIBED)
        expect(rslt[0][1]).to.equal(1234)

        expect(rslt[1][0]).to.equal(WAMP.EVENT)
        expect(rslt[1][3].topic).to.equal('topic1')
        expect(rslt[1][3].retained).to.equal(true)
        expect(rslt[1][4]).to.deep.equal([{ data: 'retain-the-value' }])

        expect(subSpy).to.have.been.called.twice()
      })
  
      it('storage-retain-weak:' + run.it, async () => {
        await api.publish('topic2', ['arg1', 'arg2'], { retain: true, will: null, acknowledge: true })

        let storedValue = []
        await realm.getKey(['topic2'], (uri, value)=>storedValue.push([uri,value]))
        expect(storedValue).to.deep.equal([[['topic2'], {kv:['arg1', 'arg2']}]])

        await api.session().cleanup()

        let spyValueNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyValueNotExists)
        expect(spyValueNotExists).to.not.have.been.called()
      })
  
      it('wamp-key-remove:' + run.it, async () => {
        await api.publish(['topic2'], { some: 'value' }, { retain: true, acknowledge: true })
        let storedValue = []
        await realm.getKey(['topic2'], (uri, value)=>storedValue.push([uri,value]))
        expect(storedValue).to.deep.equal([[['topic2'], {kv:{some:'value'}}]])

        // no kwargs is sent if kwargs passed as null
        await api.publish('topic2', null, { retain: true, acknowledge: true })

        var spyNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyNotExists)

        expect(spyNotExists).to.not.have.been.called()
      })
  
      // realm must PUSH data if client has disconnect WILL registered
      it('push-will:' + run.it, async () => {
        let events = []
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
        expect(events.shift()).to.deep.equal({ info: 'event-value' })
        expect(events.shift()).to.deep.equal({ args: { info: 'will-value' }})
        assert.equal(0, events.length)
        assert.isFalse(wampApi.hasSendError(), wampApi.firstSendErrorMessage())
      })
    
      it('push-watch-for-push:' + run.it, async () => {
        let events = []
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
        expect(events.shift()).to.deep.equal({ event: 'first event value' })

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
        expect(events.shift()).to.deep.equal({ event: 'second value is set when value empty' })

        await promiseWaitForEmpty
        expect(events.shift()).to.deep.equal(null)

        let storage = []
        await realm.getKey(['watch', 'test'], (uri, value) => {
          storage.push([uri,getBodyValue(value)])
        })
        // TODO: fix-me in db
        // expect(storage).to.deep.equal([[['watch', 'test'], { event: 'second value is set when value empty' }]])
      })

      it('push-watch-for-will', async () => {
        let defer = []
        let events = []
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

        expect(events.shift()).to.deep.equal({ event: 'value-1' })
        expect(events.shift()).to.deep.equal({ event: 'value-2' }) // ?? move below ?/
        expect(events.shift()).to.not.exist
        expect(events.length).to.equal(0)
      })
    
    })
  })
})
