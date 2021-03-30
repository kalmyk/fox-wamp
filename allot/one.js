'use strict'

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const { DbBinder } = require('../lib/sqlite/dbbinder')
const Router = require('../index')
const { BaseRealm } = require('../lib/realm')
const { ReactEngine } = require('../lib/binder')

async function main () {
  const db = await sqlite.open({
    filename: '../dbfiles/msgdb.sqlite',
    driver: sqlite3.Database
  })

  const binder = new DbBinder(db)
  const maxId = await binder.init()
  binder.startIntervalTimer()
  console.log('loaded max id:', maxId)

  const router = new Router()
  router.createRealm = () => new BaseRealm(router, new ReactEngine(binder))
  router.setLogTrace(true)
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
}

main().then((value) => {
  console.log('DONE.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
