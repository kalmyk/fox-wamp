const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import Router from '../lib/router'
import {BaseRealm, BaseEngine} from '../lib/realm'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import { getConfigInstance } from '../lib/masterfree/config'
import { HyperNetClient, listenHyperNetServer } from '../lib/hyper/net_transport'
import { FoxGate } from '../lib/hyper/gate'
import { INTRA_REALM_NAME } from '../lib/masterfree/hyper.h'

const config = getConfigInstance()
const router = new Router()
router.setId(conf_node_id)

function mkGate(host, port, gateId, stageOneTask) {
  // const client = new HyperNetClient({host, port})
  // client.onopen(async () => {
  //   await client.login({realm: INTRA_REALM_NAME})
  //   console.log('login successful', gateId, host, port)
  //   await stageOneTask.listenEntry(client)
  // })
  // client.connect()
}

function mkSync(host, port, nodeId, stageOneTask) {
  const client = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: INTRA_REALM_NAME})
    console.log('login successful', nodeId, host, port)
    await stageOneTask.listenPeerStageOne(client)
  })
  return client.connect()
}

config.loadConfigFile(conf_config_file).then(async () => {
  const nodeConf = config.getSyncById(conf_node_id)
  const syncNodes = config.getSyncNodes()

  const sysRealm = new BaseRealm(router, new BaseEngine())
  await router.initRealm(INTRA_REALM_NAME, sysRealm)
  router.setLogTrace(true)
  const stageOneTask = new StageOneTask(sysRealm, conf_node_id, config.getSyncQuorum(), Object.keys(syncNodes))
  stageOneTask.startActualizePrefixTimer()

  console.log('SYNC_ID:', conf_node_id, 'Listening FOX port:', nodeConf.port)
  listenHyperNetServer(new FoxGate(router), { port: nodeConf.port })

  for (const syncNodeId of Object.keys(syncNodes)) {
    const syncNodeConf = syncNodes[syncNodeId]
    if (syncNodeId === conf_node_id) {
      // do not listen to self realm
      // stageOneTask.listenPeerStageOne(sysRealm.api())
      continue
    }
    mkSync(syncNodeConf.host, syncNodeConf.port, syncNodeId, stageOneTask)
  }

  const entryNodes = config.getEntryNodes()
  for (const entryNodeId of Object.keys(entryNodes)) {
    const entryNodeConf = entryNodes[entryNodeId]
    mkGate(entryNodeConf.host, entryNodeConf.port, entryNodeId, stageOneTask)
  }
}).catch((err) => {
  console.error('Error loading:', err)
  process.exit(1)
})

