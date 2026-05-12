const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_fox_port = process.env.FOX_PORT
  || console.log('FOX_PORT must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { WampGate } from '../lib/wamp/gate'
import { FoxGate } from '../lib/hyper/gate'
import { listenHyperNetServer } from '../lib/hyper/net_transport'
import { WampServer } from '../lib/wamp/transport'
import listenMqttServer from '../lib/mqtt/transport'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { MqttGate } from '../lib/mqtt/gate'
import { getConfigInstance } from '../lib/masterfree/config'

const router: Router = new Router()
const netEngineMill: NetEngineMill = new NetEngineMill(router)

router.setId(conf_node_id)
router.createRealm = (): BaseRealm => new BaseRealm(router, new NetEngine(netEngineMill))
router.setLogTrace(true)

const config = getConfigInstance()

async function main() {
  listenHyperNetServer(new FoxGate(router), { port: Number(conf_fox_port) })

  const conf_config_file = process.env.CONFIG
  if (conf_config_file) {
    await config.loadConfigFile(conf_config_file)
    try {
      // wait for initialization handshake to complete before starting other servers
      console.log('Waiting for entry initialization handshake...')
      await netEngineMill.initHandshake(config.getSyncQuorum())
      console.log('Entry initialization completed.')
    } catch (err) {
      console.error('Entry initialization failed, but starting anyway (or you might want to exit):', (err as any) && (err as any).message)
      // process.exit(1) // Optional: fail fast
    }
  }

  new WampServer(new WampGate(router), { port: Number(conf_wamp_port) })
  listenMqttServer(new MqttGate(router), { port: Number(conf_mqtt_port) })

  console.log('ENTRY_ID:', conf_node_id, 'listening WAMP:', conf_wamp_port, 'MQTT:', conf_mqtt_port, 'FOX:', conf_fox_port)
}

main().catch(err => {
  console.error('Error in main:', err)
  process.exit(1)
})
