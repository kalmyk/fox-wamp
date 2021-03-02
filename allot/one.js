'use strict'

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const Msg = require('../lib/sqlite/msg')
const { DbBinder } = require('../lib/sqlite/dbrouter')
const Router = require('../index')

async function main () {
  const db = await sqlite.open({
    filename: '../dbfiles/msgdb.sqlite',
    driver: sqlite3.Database
  })

  const data = new Msg(db)

  await data.createTables()
  const id = await data.getMaxId()
  console.log('loaded max id:', id)

  const router = new Router(new DbBinder(data))
  router.setLogTrace(true)
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
}

main().then((value) => {
  console.log('DONE.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
