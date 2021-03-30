'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')

const WAMP     = require('../lib/wamp/protocol')
const WampGate = require('../lib/wamp/gate')
const Router       = require('../lib/router')
const { DbBinder }   = require('../lib/sqlite/dbbinder')
const { SqliteKv }   = require('../lib/sqlite/sqlitekv')
const { MemEngine } = require('../lib/mono/memengine')
const { ReactEngine } = require('../lib/binder')
const { MemKeyValueStorage } = require('../lib/mono/memkv')
const { BaseRealm } = require('../lib/realm')

chai.use(promised)
chai.use(spies)

const mkMemRealm = async (router) => {
  let realm = new BaseRealm(router, new MemEngine())
  realm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
  return realm
}

const mkDbRealm = async (router) => {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })

  let binder = new DbBinder(db)
  await binder.init()
  let realm = new BaseRealm(router, new ReactEngine(binder))

  let kv = new SqliteKv(db)
  await kv.createTables()
  realm.registerKeyValueEngine(['#'], kv)

  return realm
}

const runs = [
  {it: 'mem', mkRealm: mkMemRealm },
  {it: 'db',  mkRealm: mkDbRealm  },
]

describe('08. KV', function () {
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

      beforeEach(async function () {
        router = new Router()
        realm = await run.mkRealm(router)
        router.addRealm('test-realm', realm)       
        api = realm.wampApi()

        sender = {}
        gate = new WampGate(router)
        cli = gate.createSession()
        ctx = gate.createContext(cli, sender)
        realm.joinSession(cli)
      })
    
      afterEach(function () {
        cli.cleanup()
        ctx = null
      })
  
      it('storage-retain-get:' + run.it, async () => {
        var subSpy = chai.spy(function () {})
        await api.subscribe('topic1', subSpy)
        await api.publish('topic1', [], { data: 'retain-the-value' }, { retain: 100 })
        await api.publish('topic1', [], { data: 'the-value-does-not-retain' })

        let done
        let resultPromise = new Promise((resolve) => done = resolve)
        let counter = 2
        sender.send = chai.spy(
          (msg, callback) => {
            // console.log('MSG', counter, msg)
            if (counter === 2) {
              expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
              expect(msg[1]).to.equal(1234)
            } else {
              expect(msg[0]).to.equal(WAMP.EVENT)
              expect(msg[3].topic).to.equal('topic1')
              expect(msg[3].retained).to.equal(true)
              expect(msg[5]).to.deep.equal({ data: 'retain-the-value' })
            }
            --counter
            if (counter <= 0) {
              done()
              done = undefined
            }
          }
        )
        cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'topic1'])
        return resultPromise
      })
  
    })
  })
})
