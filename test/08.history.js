'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const Router       = require('../lib/router')
const WampApi      = require('../lib/wamp/api')
const {MemBinder}  = require('../lib/mono/membinder')
const {DbBinder}   = require('../lib/sqlite/dbrouter')

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const Msg = require('../lib/sqlite/msg')
const { Kv } = require('../lib/sqlite/kv')

chai.use(promised)
chai.use(spies)

const mkDb = async function () {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  let msg = new Msg(db)
  let kv = new Kv(db)
  await msg.createTables()
  await kv.createTables()
  return new DbBinder(msg, kv)
}

const runs = [
  {it: 'mem',  mkBinder: async () => new MemBinder()},
  {it: 'db',  mkBinder: mkDb },
]

describe('08. history', function () {
  runs.forEach(function (run) {
    describe('event-history:' + run.it, function () {
      let
        router,
        realm,
        api

      beforeEach(async function () {
        router = new Router(await run.mkBinder())
        realm = router.createRealm()
        router.addRealm('test-realm-name', realm)
        api = realm.wampApi()
      })
    
      afterEach(function () {
      })
  
      it('receive-event-history:' + run.it, async function () {
        let expectedData = [
          {event:'row1'},
          {event:'row2'},
          {event:'row3'},
        ]

        let startPos = await api.publish('test-topic', [], {event:'data'}, {acknowledge: true, trace: true})
        expect(startPos).to.exist

        await Promise.all([
          api.publish('test-topic', [], {event:'row1'}, {acknowledge: true, trace: true}),
          api.publish('test-topic', [], {event:'row2'}, {acknowledge: true, trace: true}),
          api.publish('test-topic', [], {event:'row3'}, {acknowledge: true, trace: true}),
        ])

        let subId
        return new Promise((resolve, reject) => {  
          return api.subscribe(
            'test-topic',
            (id, args, kwargs) => {
              try {
                // console.log('#', id, kwargs);
                expect(kwargs).to.deep.equal(expectedData.shift())
                if (expectedData.length == 0) {
                  resolve(subId)
                }
              } catch (e) {
                reject(e)
              }
            },
            {after: startPos}
          ).then((sub) => {
            subId = sub
          })
        }).then((sub) => {
          api.unsubscribe(subId)
        })
      })

      it('push-will:'+ run.it, async function () {
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
          { retain: true, will: { kv: { will: 'value' } } }
        )

        expect(event).to.have.been.called.once()
        cli.cleanup()
        expect(event).to.have.been.called.twice()
      })
    
    })
  })
})
