'use strict'

// validate that memory storage has the same results as sqlite

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const sqlite3     = require('sqlite3')
const sqlite      = require('sqlite')

const WAMP            = require('../lib/wamp/protocol')
const WampGate        = require('../lib/wamp/gate')
const Router          = require('../lib/router')
const { SqliteModKv, SqliteKv }    = require('../lib/sqlite/sqlitekv')
const { MemEngine }   = require('../lib/mono/memengine')
const { DbEngine, DbBinder } = require('../lib/sqlite/dbbinder')
const { MemKeyValueStorage } = require('../lib/mono/memkv')
const { BaseRealm }   = require('../lib/realm')
const WampApi         = require('../lib/wamp/api')

chai.use(promised)
chai.use(spies)

const TEST_REALM_NAME = 'test-realm'

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

  let binder = new DbBinder(db)
  await binder.init()
  let realm = new BaseRealm(router, new DbEngine(binder))

  let modKv = new SqliteModKv(db)
  await modKv.createTables()

  let kv = new SqliteKv(modKv, binder.getMakeId(), TEST_REALM_NAME)
  realm.registerKeyValueEngine(['#'], kv)

  return realm
}

const runs = [
  {it: 'mem', mkRealm: makeMemRealm },
  {it: 'db',  mkRealm: makeDbRealm  },
]

describe('31 KV', function () {
  runs.forEach(function (run) {
    describe('event-history:' + run.it, function () {
      let
        router,
        realm,
        api,
        sender,
        gate,
        cli,
        ctx

      beforeEach(async () => {
        router = new Router()
        realm = await run.mkRealm(router)
        router.addRealm(TEST_REALM_NAME, realm)       
        api = realm.wampApi()

        sender = {}
        gate = new WampGate(router)
        cli = gate.createSession()
        ctx = gate.createContext(cli, sender)
        realm.joinSession(cli)
      })
    
      afterEach(async () => {
        cli.cleanup()
        ctx = null
      })
  
      it('storage-retain-get:' + run.it, async () => {
        const subSpy = chai.spy(() => {})
        await api.subscribe('topic1', subSpy)
        await api.publish('topic1', [], { data: 'retain-the-value' }, { retain: true, exclude_me:false })
        await api.publish('topic1', [], { data: 'the-value-does-not-retain' }, { exclude_me:false })

        let done
        let resultPromise = new Promise((resolve) => done = resolve)
        let counter = 2
        let rslt = []
        sender.send = chai.spy((msg) => {
          rslt.push(msg)
          --counter
          if (counter <= 0) {
            done()
            done = undefined
          }
        })
        cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'topic1'])
        await resultPromise

        expect(rslt[0][0]).to.equal(WAMP.SUBSCRIBED)
        expect(rslt[0][1]).to.equal(1234)

        expect(rslt[1][0]).to.equal(WAMP.EVENT)
        expect(rslt[1][3].topic).to.equal('topic1')
        expect(rslt[1][3].retained).to.equal(true)
        expect(rslt[1][5]).to.deep.equal({ data: 'retain-the-value' })

        expect(subSpy).to.have.been.called.twice()
      })
  
      it('storage-retain-weak:' + run.it, async () => {
        var spyExists = chai.spy(()=>{})
        var spyNotExists = chai.spy(()=>{})

        await api.publish('topic2', ['arg.1', 'arg.2'], {}, { retain: true, will: null })
        await realm.getKey(['topic2'], spyExists)
        await api.cleanup()
        await realm.getKey(['topic2'], spyNotExists)

        expect(spyExists).to.have.been.called.once()
        expect(spyNotExists).to.not.have.been.called()
      })
  
      it('wamp-key-remove:' + run.it, async () => {
        await api.publish(['topic2'], ['arg.1'], { some: 'value' }, { retain: true })
        var spyExists = chai.spy(()=>{ /* exists */ })
        await realm.getKey(['topic2'], spyExists)

        // no kwargs is sent if kwargs passed as null
        await api.publish('topic2', [], null, { retain: true })

        var spyNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyNotExists)

        expect(spyExists).to.have.been.called.once()
        expect(spyNotExists).to.not.have.been.called()
      })
  
      // realm must PUSH data if client has WILL request registered
      it('push-will:' + run.it, async () => {
        let expectedData = [
          { event: 'value' },
          { will: 'value' },
        ]
    
        const event = chai.spy((id, args, kwargs) => {
          expect(kwargs).to.deep.equal(expectedData.shift())
        })
        await api.subscribe('will.test', event)
    
        let cli = new WampApi(realm, router.makeSessionId())
        realm.joinSession(cli)
    
        await cli.publish(
          'will.test',
          [],
          { event: 'value' },
          { acknowledge: true, trace: true, retain: true, will: { kv: { will: 'value' } } }
        )
    
        expect(event).to.have.been.called.once()
        await cli.cleanup()
        expect(event).to.have.been.called.twice()
      })
    
      it('push-watch-for-push:' + run.it, async () => {
        let curPromise
        let n = 0
        sender.send = (msg) => {
          n++
          if (n === 1) {
            expect(msg[0]).to.equal(WAMP.PUBLISHED)
            expect(msg[1]).to.equal('init-kv')
          } else if (n === 2) {
            expect(msg[0]).to.equal(WAMP.PUBLISHED)
            expect(msg[1]).to.equal('watch-for-value')
          }
          curPromise()
          curPromise = undefined
        }
        sender.close = (a, b) => {
          console.log("SENDER.CLOSE", a, b)
        }
    
        const api = realm.foxApi()
    
        let m = 0
        const onEvent = chai.spy((event, opt) => {
          m++
          if (m === 1) {
            expect(event).to.deep.equal( { args:[], kwargs: { event: 'value' } })
          } else if (m === 2) {
            expect(event).to.equal(null)
          } else if (m === 3) {
            expect(event).to.deep.equal({ args:[], kwargs: { event: 'watch-for-empty' } })
          }
        })
        api.subscribe(['watch', 'test'], onEvent, { retained:true })

        await new Promise((resolve) => {
          curPromise = resolve
          cli.handle(ctx, [
            WAMP.PUBLISH,
            'init-kv',
            {
              retain: true,
              trace: true,
              exclude_me: false,
              acknowledge: true
            },
            'watch.test',
            [],
            { event: 'value' }
          ])
        })

        expect(onEvent).to.have.been.called.once()

        cli.handle(ctx, [
          WAMP.PUBLISH,
          'watch-for-value',
          {
            trace: true,
            retain: true,
            when: null,
            watch: true,
            acknowledge: true
          },
          'watch.test',
          [],
          { event: 'watch-for-empty' }
        ])
        expect(onEvent).to.have.been.called.once()
    
        await new Promise((resolve) => {
          curPromise = resolve
          api.publish(['watch', 'test'], null, { trace: true, retain: true })  
        })
        expect(onEvent).to.have.been.called.exactly(3)
      })

    })

  })
})
