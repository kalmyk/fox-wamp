'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')

const { BaseRealm } = require('../lib/realm')
const Router       = require('../lib/router')
const { DbEngine, DbBinder }   = require('../lib/sqlite/dbbinder')
const { MemEngine } = require('../lib/mono/memengine')

chai.use(promised)
chai.use(spies)

const mkDbEngine = async () => {
  let db = await sqlite.open({
    filename: ':memory:',
    driver: sqlite3.Database
  })
  let binder = new DbBinder(db)
  await binder.init()
  return new DbEngine(binder)
}

const runs = [
  {it: 'mem', mkEngine: async () => new MemEngine()},
  {it: 'db',  mkEngine: mkDbEngine },
]

describe('08. history', function () {
  runs.forEach(function (run) {
    describe('event-history:' + run.it, function () {
      let
        router,
        realm,
        api

      beforeEach(async function () {
        router = new Router()
        realm = new BaseRealm(router, await run.mkEngine())
        router.addRealm('test-realm', realm)
        api = realm.wampApi()
      })
    
      afterEach(function () {
      })
  
      it('receive-event-history:' + run.it, async () => {
        let expectedData = [
          {event:'row1'},
          {event:'row2'},
          {event:'row3'},
        ]

        let startPos = await api.publish('test-topic', [], {event:'data'}, {acknowledge: true, trace: true})
        expect(startPos, "startPos").to.exist

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
    
    })
  })
})
