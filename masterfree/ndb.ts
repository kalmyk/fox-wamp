const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import { keyDate, ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { ProjectionListener } from '../lib/sqlite/projection_listener'
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
  })
  return client.connect()
}

function mkGate(host: string, port: number, gateId: string, storageTask: StorageTask) {
  const client = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: INTRA_REALM_NAME})
    console.log('login successful', gateId, host, port)
    try {
      console.log('attaching gate listener', gateId)
      await storageTask.listenEntry(client, gateId)
    } catch (err) {
      console.error('Failed to attach gate listener:', (err as any) && (err as any).message)
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

  config.validateSchemasForNode(conf_node_id)
  const schemas = config.findSchemasForNode(conf_node_id)
  if (schemas.length === 0) {
    console.warn(`NODE_ID="${conf_node_id}" not found in any eventNodes schema — falling back to broadcast`)
  }
  const storageTask: StorageTask = new StorageTask(sysRealm, dbFactory, schemas)
  const stageTwoTask: StageTwoTask = new StageTwoTask(sysRealm, config.getSyncQuorum())

  const makeId: ProduceId = new ProduceId(() => keyDate(new Date()))
  new ProjectionListener(dbFactory, db, makeId)
  
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
