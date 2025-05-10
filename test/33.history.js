'use strict'

const chai        = require('chai')
const assert      = chai.assert
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')

const { BaseRealm }  = require('../lib/realm')
const Router         = require('../lib/router')
const { DbEngine }   = require('../lib/sqlite/dbengine')
const { MemEngine }  = require('../lib/mono/memengine')
const { initDbFactory, getDbFactoryInstance } = require('../lib/sqlite/dbfactory')
const { keyDate, ProduceId } = require('../lib/allot/makeid')
const { SqliteModKv }    = require('../lib/sqlite/sqlitekv')

chai.use(promised)
chai.use(spies)

initDbFactory()

const mkDbEngine = async () => {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  getDbFactoryInstance().setMainDb(db)
  return new DbEngine(
    new ProduceId(() => keyDate(new Date())),
    new SqliteModKv()
  )
}

const runs = [
  {it: 'mem', mkEngine: async () => new MemEngine()},
  {it: 'db',  mkEngine: mkDbEngine },
]

describe('33 history', function () {
  runs.forEach(function (run) {
    describe('event-history:' + run.it, function () {
      let
        router,
        realm,
        api

      beforeEach(async () => {
        router = new Router()
        realm = new BaseRealm(router, await run.mkEngine())
        await router.initRealm('testrealm', realm)
        api = realm.api()
      })
    
      afterEach(async () => {
        assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
      })
  
      it('receive-event-history:' + run.it, async () => {
        let events = []

        let startPos = await api.publish('test-topic', {event:'data'}, {acknowledge: true, trace: true})
        expect(startPos, "startPos").to.exist

        await Promise.all([
          api.publish('test-topic', {event:'history1'}, {acknowledge: true, trace: true}),
          api.publish('test-topic', {event:'history2'}, {acknowledge: true, trace: true}),
          api.publish('test-topic', {event:'history3'}, {acknowledge: true, trace: true}),
        ])
        let doneEvents
        const onEvent = event => {
          events.push(event)
          if (events.length >= 3) {
            doneEvents(events)
          }
        }
        const donePromise =  new Promise((resolve) => doneEvents = resolve)
        let subId = await api.subscribe(
          'test-topic',
          onEvent,
          {after: startPos}
        )
        expect(await donePromise).to.deep.equal([
          {event:'history1'},
          {event:'history2'},
          {event:'history3'},
        ])

        await api.unsubscribe(subId)
      })
    })
  })
})
