'use strict'

const { DbFactory } = require('../lib/sqlite/dbfactory')
const History = require('../lib/sqlite/history')
const { OneDbRouter } = require('../lib/sqlite/onedbrouter')

async function main () {
  const dbFactory = new DbFactory()
  const db = await dbFactory.openMainDatabase('../dbfiles/msgdb.sqlite')

  const maxId = await History.scanMaxId(db)
  console.log('loaded max id:', maxId)

  const router = new OneDbRouter(dbFactory)
  router.setLogTrace(true)
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
