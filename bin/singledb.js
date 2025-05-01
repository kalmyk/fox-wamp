'use strict'

const { initDbFactory } = require('../lib/sqlite/dbfactory')
const History = require('../lib/sqlite/history')
const { DbEngine } = require('../lib/sqlite/dbengine')
const { SqliteModKv, SqliteKv } = require('../lib/sqlite/sqlitekv')
const Router = require('../index')
const { BaseRealm } = require('../lib/realm')

async function main () {
  const dbFactory = await initDbFactory()
  const db = await dbFactory.openMainDatabase('../dbfiles/msgdb.sqlite')

  const maxId = await History.scanMaxId(db)

  dbFactory.startActualizePrefixTimer()
  console.log('loaded max id:', maxId)

  const modKv = new SqliteModKv()
  await modKv.createTables()

  const router = new Router()
  router.createRealm = (realmName) => { 
    const realm = new BaseRealm(router, new DbEngine())
    realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, dbFactory.getMakeId(), realmName))
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
