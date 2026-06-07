'use strict'

const { DbFactory } = require('../lib/sqlite/dbfactory')
const History = require('../lib/sqlite/history')
const { OneDbRouter } = require('../lib/sqlite/onedbrouter')
const { StorageTask } = require('../lib/masterfree/storage')
const { ProjectionListener } = require('../lib/sqlite/projection_listener')

async function main () {
  const dbFactory = new DbFactory()
  const db = await dbFactory.openMainDatabase('../dbfiles/msgdb.sqlite')

  const maxId = await History.scanMaxId(db)
  console.log('loaded max id:', maxId)

  const router = new OneDbRouter(dbFactory)
  router.setLogTrace(true)

  const sysRealm = await router.getRealm('sys')
  const storageTask = new StorageTask(sysRealm, dbFactory)
  new ProjectionListener(storageTask, db, router.getMakeId())

  router.startActualizePrefixTimer()
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
  router.listenHyperNet({ port: 1735 })
}

main().then((value) => {
  console.log('listen started.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
