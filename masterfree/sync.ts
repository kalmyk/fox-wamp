const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import Router from '../lib/router'
import {BaseRealm, BaseEngine} from '../lib/realm'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import { Config, getConfigInstance } from '../lib/masterfree/config'
import { HyperNetClient, listenHyperNetServer } from '../lib/hyper/net_transport'
import { FoxGate } from '../lib/hyper/gate'
import { INTRA_REALM_NAME } from '../lib/masterfree/hyper.h'

const config: Config = getConfigInstance()
const router: Router = new Router()
router.setId(conf_node_id)

function mkSync(host: string, port: number, nodeId: string, stageOneTask: StageOneTask) {
  const client = new HyperNetClient({host, port})
  client.onopen(async () => {
    await client.login({realm: 'realm1'})
    console.log('login successful', nodeId, host, port)
    await stageOneTask.listenStageOne(client)
  })
  console.log('connect to sync:', nodeId, host, port)
  return client.connect()
}

config.loadConfigFile(conf_config_file).then(async () => {
  const nodeConf = config.getSyncById(conf_node_id)

  const sysRealm = new BaseRealm(router, new BaseEngine())
  await router.initRealm(INTRA_REALM_NAME, sysRealm)
  const stageOneTask = new StageOneTask(sysRealm, config.getSyncQuorum())
  stageOneTask.startActualizePrefixTimer()

  console.log('SYNC_ID:', conf_node_id, 'Listening FOX port:', nodeConf.port)
  listenHyperNetServer(new FoxGate(router), <any>{ port: nodeConf.port })

  const syncNodes = config.getSyncNodes()
  for (const syncNodeId of Object.keys(syncNodes)) {
    const syncNodeConf = syncNodes[syncNodeId]
    if (syncNodeId === conf_node_id) {
      stageOneTask.listenStageOne(sysRealm.api())
      continue
    }
    mkSync(syncNodeConf.host, syncNodeConf.port, syncNodeId, stageOneTask)
  }
}).catch((err) => {
  console.error('Error loading:', err)
  process.exit(1)
})

