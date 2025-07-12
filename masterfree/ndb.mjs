const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

import { ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import Router from '../lib/router'
import Config from '../lib/masterfree/config'
import { initDbFactory } from '../lib/sqlite/dbfactory'
import { StorageTask } from '../lib/masterfree/storage'
import { StageTwoTask } from '../lib/masterfree/synchronizer'
import { INTRA_REALM_NAME } from '../lib/masterfree/netengine.h'
import { HyperNetClient } from '../lib/hyper/net_transport'

const router = new Router()
const sysRealm = await router.getRealm(INTRA_REALM_NAME)

const storageTask = new StorageTask(sysRealm)
const stageTwoTask = new StageTwoTask(sysRealm)

function mkSync(host, port, nodeId) {
  const client = new HyperNetClient({host, port})
  client.onopen(() => {
    client.login({realm: 'realm1'})
    console.log('login successful', nodeId, host, port)
  })
  client.onclose(() => {
    console.log('Sync client closed:', nodeId)
  })

  console.log('connect to sync:', nodeId, host, port)
  return client.connect()
}

function mkGate(uri, gateId, modKv) {
}

async function main () {
  const config = Config.getInstance()

  const makeId = new ProduceId(() => keyDate(new Date()))
  const dbFactory = await initDbFactory()
  const db = await dbFactory.openMainDatabase(conf_db_file)

  const modKv = new SqliteKvFabric(dbFactory, makeId)

  for (const syncNodeConf of config.getSyncNodes()) {
    mkSync(syncNodeConf.host, syncNodeConf.port, syncNodeConf.nodeId)
  }
  for (const entry of config.getEntryNodes()) {
    mkGate(entry.url, entry.nodeId, modKv)
  }
}

Config.getInstance().loadConfigFile(conf_config_file).then(() => {
  main()
  console.log('connect function started')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
