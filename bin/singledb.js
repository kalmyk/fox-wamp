'use strict'

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const { DbEngine, DbBinder } = require('../lib/sqlite/dbbinder')
const { SqliteModKv, SqliteKv } = require('../lib/sqlite/sqlitekv')
const Router = require('../index')
const { BaseRealm } = require('../lib/realm')

async function main () {
  const db = await sqlite.open({
    filename: '../dbfiles/msgdb.sqlite',
    driver: sqlite3.Database
  })

  const binder = new DbBinder(db)
  const maxId = await binder.init()
  binder.startIntervalTimer()
  console.log('loaded max id:', maxId)

  const modKv = new SqliteModKv(db)
  await modKv.createTables()

  const router = new Router()
  router.createRealm = (realmName) => { 
    const realm = new BaseRealm(router, new DbEngine(binder))
    realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, binder.getMakeId(), realmName))
    return realm
  }
  router.setLogTrace(true)
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
}

main().then((value) => {
  console.log('listen started.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
