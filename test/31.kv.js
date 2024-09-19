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
        ctx,
        step

      setTimeout(
        () => { console.log("timeout at step", step) },
        500
      )

      beforeEach(async () => {
        step = 0
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
        assert.isFalse(cli.hasSendError(), cli.firstSendErrorMessage())
        assert.isFalse(api.hasSendError(), api.firstSendErrorMessage())
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
        var spyValueExists = chai.spy((uri, value)=>{
          expect(uri).to.deep.equal(['topic2'])
          expect(value).to.deep.equal({ args: [ 'arg1', 'arg2' ], kwargs: {} })
        })
        var spyValueNotExists = chai.spy(()=>{})

        await api.publish('topic2', ['arg1', 'arg2'], {}, { retain: true, will: null, acknowledge: true })
        await realm.getKey(['topic2'], spyValueExists)
        await api.cleanup()
        await realm.getKey(['topic2'], spyValueNotExists)

        expect(spyValueExists).to.have.been.called.once()
        expect(spyValueNotExists).to.not.have.been.called()
      })
  
      it('wamp-key-remove:' + run.it, async () => {
        await api.publish(['topic2'], ['arg1'], { some: 'value' }, { retain: true, acknowledge: true })
        var spyValueExists = chai.spy((uri, value)=>{
          expect(uri).to.deep.equal(['topic2'])
          expect(value).to.deep.equal({ args: [ 'arg1' ], kwargs: {some: 'value'} })
        })
        await realm.getKey(['topic2'], spyValueExists)

        // no kwargs is sent if kwargs passed as null
        await api.publish('topic2', [], null, { retain: true, acknowledge: true })

        var spyNotExists = chai.spy(()=>{})
        await realm.getKey(['topic2'], spyNotExists)

        expect(spyValueExists).to.have.been.called.once()
        expect(spyNotExists).to.not.have.been.called()
      })
  
      // realm must PUSH data if client has disconnect WILL registered
      it('push-will:' + run.it, async () => {
        let expectedData = [
          { event: 'value' },
          { will: 'value' },
        ]
        const event = chai.spy((id, args, kwargs) => {
          expect(kwargs).to.deep.equal(expectedData.shift())
        })
        await api.subscribe('will.test', event)
    
        const client = new WampApi(realm, router.makeSessionId())
        realm.joinSession(client)
    
        await client.publish(
          'will.test',
          [],
          { event: 'value' },
          {
            acknowledge: true,
            trace: true,
            retain: true,
            will: { kv: { will: 'value' } }
          }
        )
    
        expect(event).to.have.been.called.once()
        await client.cleanup()
        expect(event).to.have.been.called.twice()
        assert.isFalse(client.hasSendError(), client.firstSendErrorMessage())
      })
    
      it('push-watch-for-push:' + run.it, async () => {
        let eventNo = 0
        const haveGotEvent = chai.spy((publicationId, args, kwargs, opt) => {
          if (eventNo === 0) {
            assert.equal(++step, 2, 'first event dispatched')
            expect(args).to.deep.equal([])
            expect(kwargs).to.deep.equal({ event: 'first event value' })
          } else if (eventNo === 1) {
            // inbound event arrived, no changes in storage
            expect(args).to.deep.equal([])
            expect(kwargs).to.deep.equal({ event: 'second value is set when value empty' })
          } else if (eventNo === 2) {
            // storage is erased
            expect(args).to.deep.equal([])
            expect(kwargs).to.equal(undefined)
          } else if (eventNo === 3) {
            // when action triggered
            expect(args).to.deep.equal([])
            expect(kwargs).to.deep.equal({ event: 'second value is set when value empty' })
          }
          eventNo++
        })
        await api.subscribe('watch.test', haveGotEvent)
        assert.equal(++step, 1, 'subscribed one')

        await api.publish(
          'watch.test',
          [],
          { event: 'first event value' },
          {
            trace: true,
            retain: true,
            exclude_me: false,
            acknowledge: true
          }
        )
        expect(haveGotEvent).to.have.been.called.once()

        const promiseWaitForEmpty = api.publish(
          'watch.test',
          [],
          { event: 'second value is set when value empty' },
          {
            trace: true,
            retain: true,
            when: null,
            watch: true,
            exclude_me: false,
            acknowledge: true
          }
        ).then(() => {
          // assert.equal(++step, 3, 'watch when value empty')
        })
    
        await api.publish(
          'watch.test',
          [],
          null,
          {
            trace: true,
            retain: true,
            exclude_me: false,
            acknowledge: true 
          }
        ).then(() => {
          assert.equal(++step, 3, 'value erased')
        })
        await promiseWaitForEmpty
        assert.equal(++step, 4, 'value is second event')
        await realm.getKey(['watch', 'test'], (uri, value) => {
          // console.log("~", uri, value)
        })
        expect(haveGotEvent).to.have.been.called.exactly(3)  // TODO: event on storage update
      })

    })

  })
})
