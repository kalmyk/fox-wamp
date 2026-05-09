const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

import { keyDate, ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { Router } from '../lib/router'
import { getConfigInstance } from '../lib/masterfree/config'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { StorageTask } from '../lib/masterfree/storage'
import { StageTwoTask } from '../lib/masterfree/synchronizer'
import { INTRA_REALM_NAME } from '../lib/masterfree/hyper.h'
import { HyperNetClient } from '../lib/hyper/net_transport'

function mkSync(host: string, port: number, nodeId: string, storageTask: StorageTask, stageTwoTask: StageTwoTask) {
  const client: HyperNetClient = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: INTRA_REALM_NAME})
    console.log('login successful', nodeId, host, port)
    await stageTwoTask.listenStageOne(client)
    await storageTask.listenStageOne(client)
    // initiate initialization handshake for storage when connection to sync peer is established
    try {
      // start handshake but do not wait on every individual connection; storageTask will deduplicate
      storageTask.initHandshake && storageTask.initHandshake(config.getSyncQuorum()).then((maxAdvanceId) => {
        console.log('Storage init quorum reached, maxAdvanceId=', maxAdvanceId)
      }).catch((err) => {
        console.error('Storage initHandshake error:', (err as any) && (err as any).message)
      })
    } catch (err) {
      console.error('error initiating initHandshake:', err)
    }
  })
  return client.connect()
}

function mkGate(host: string, port: number, gateId: string, storageTask: StorageTask) {
  const client = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: INTRA_REALM_NAME})
    console.log('login successful', gateId, host, port)
    try {
      // wait for storage initialization handshake to complete before exposing gate
      await storageTask.initHandshake && storageTask.initHandshake(config.getSyncQuorum())
      console.log('storage initialization completed, attaching gate listener', gateId)
      await storageTask.listenEntry(client, gateId)
    } catch (err) {
      console.error('Storage initialization failed, aborting gate attach:', (err as any) && (err as any).message)
      // fail fast: do not expose this gate if storage is not initialized
      process.exit(1)
    }
  })
  client.connect()
}

const config = getConfigInstance()

async function main () {
  const router = new Router()
  router.setLogTrace(true)
  const sysRealm = await router.getRealm(INTRA_REALM_NAME)

  const dbFactory = new DbFactory('')
  const db = await dbFactory.openMainDatabase(conf_db_file)

  const storageTask: StorageTask = new StorageTask(sysRealm, dbFactory)
  const stageTwoTask: StageTwoTask = new StageTwoTask(sysRealm, config.getSyncQuorum())

  const makeId: ProduceId = new ProduceId(() => keyDate(new Date()))
  const modKv: SqliteKvFabric = new SqliteKvFabric(dbFactory, makeId)

  const syncNodes = config.getSyncNodes()
  for (const syncNodeId of Object.keys(syncNodes)) {
    const syncNodeConf = syncNodes[syncNodeId]
    mkSync(syncNodeConf.host, syncNodeConf.port, syncNodeId, storageTask, stageTwoTask)
  }

  const entryNodes = config.getEntryNodes()
  for (const entryNodeId of Object.keys(entryNodes)) {
    const entryNodeConf = entryNodes[entryNodeId]
    mkGate(entryNodeConf.host, entryNodeConf.port, entryNodeId, storageTask)
  }
}

config.loadConfigFile(conf_config_file).then(() => {
  main()
  console.log('connect function started')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
