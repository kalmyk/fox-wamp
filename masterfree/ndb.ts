const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

import { keyDate, ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import Router from '../lib/router'
import { Config, getConfigInstance } from '../lib/masterfree/config'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { StorageTask } from '../lib/masterfree/storage'
import { StageTwoTask } from '../lib/masterfree/synchronizer'
import { INTRA_REALM_NAME } from '../lib/masterfree/hyper.h'
import { HyperNetClient } from '../lib/hyper/net_transport'

function mkSync(host: string, port: number, nodeId: string, stageTwoTask: StageTwoTask) {
  const client = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: 'realm1'})
    console.log('login successful', nodeId, host, port)
    await stageTwoTask.listenStageOne(client)
  })
  console.log('connect to sync:', nodeId, host, port)
  return client.connect()
}

function mkGate(uri:  string, gateId: string, modKv: SqliteKvFabric) {
}

const config: Config = getConfigInstance()

async function main () {
  const router = new Router()
  const sysRealm = await router.getRealm(INTRA_REALM_NAME)

  const dbFactory = new DbFactory(null)
  const db = await dbFactory.openMainDatabase(conf_db_file)

  const storageTask = new StorageTask(sysRealm, dbFactory)
  const stageTwoTask = new StageTwoTask(sysRealm, config.getSyncQuorum())

  const makeId = new ProduceId(() => keyDate(new Date()))
  const modKv = new SqliteKvFabric(dbFactory, makeId)

  const syncNodes = config.getSyncNodes()
  for (const syncNodeId of Object.keys(syncNodes)) {
    const syncNodeConf = syncNodes[syncNodeId]
    mkSync(syncNodeConf.host, syncNodeConf.port, syncNodeId, stageTwoTask)
  }

  const entryNodes = config.getEntryNodes()
  for (const entryNodeId of Object.keys(entryNodes)) {
    const entryNodeConf = entryNodes[entryNodeId]
    mkGate(entryNodeConf.url, entryNodeId, modKv)
  }
}

config.loadConfigFile(conf_config_file).then(() => {
  main()
  console.log('connect function started')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
