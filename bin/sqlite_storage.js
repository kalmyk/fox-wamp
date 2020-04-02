const sqlite = require('sqlite')
const Msg = require('../lib/sqlite/msg')
const DbRouter = require('../lib/sqlite/dbrouter').DbRouter

async function main () {
  const db = await sqlite.open('../dbfiles/msgdb.sqlite')
  const data = new Msg(db)

  await data.createTables()
  const id = await data.getMaxId()
  console.log('loaded max id:', id)

  const router = new DbRouter(data)
  router.setLogTrace(true)
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
}

main().then((value) => {
  console.log('DONE.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
