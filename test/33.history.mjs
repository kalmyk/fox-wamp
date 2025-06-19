import chai, { expect, assert } from 'chai'
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { BaseRealm }  from '../lib/realm.js'
import Router         from '../lib/router.js'
import { DbEngine }   from '../lib/sqlite/dbengine.js'
import { MemEngine }  from '../lib/mono/memengine.js'
import { DbFactory } from '../lib/sqlite/dbfactory.js'
import { keyDate, ProduceId } from '../lib/masterfree/makeid.js'
import { SqliteKvFabric }    from '../lib/sqlite/sqlitekv.js'

const mkDbEngine = async () => {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  const dbFactory = new DbFactory()
  dbFactory.setMainDb(db)
  return new DbEngine(
    new ProduceId(() => keyDate(new Date())),
    new SqliteKvFabric(dbFactory)
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
