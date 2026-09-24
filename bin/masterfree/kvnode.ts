const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import { getConfigInstance } from '../../lib/masterfree/config'
import { startKvNode } from '../../lib/masterfree/kvnode'

const config = getConfigInstance()

config.loadConfigFile(conf_config_file).then(async () => {
  const node = await startKvNode({ nodeId: conf_node_id, dbFile: conf_db_file, config })
  const address = node.server.address()
  console.log('KV_NODE_ID:', conf_node_id, 'Listening FOX port:', address && typeof address === 'object' ? address.port : address)
}).catch((err) => {
  console.error('ERROR:', err && err.message ? err.message : err)
  process.exit(1)
})
