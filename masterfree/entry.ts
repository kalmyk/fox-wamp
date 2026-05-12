const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_fox_port = process.env.FOX_PORT
  || console.log('FOX_PORT must be defined') || process.exit(1)

const conf_node_id: string = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

const conf_quorum: string = process.env.QUORUM
  || console.log('QUORUM must be defined') || process.exit(1)

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { WampGate } from '../lib/wamp/gate'
import { FoxGate } from '../lib/hyper/gate'
import { listenHyperNetServer } from '../lib/hyper/net_transport'
import { WampServer } from '../lib/wamp/transport'
import listenMqttServer from '../lib/mqtt/transport'
import { INIT_ADVANCE_SEGMENTS_COMPLETED, NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { MqttGate } from '../lib/mqtt/gate'

async function main() {
  const router: Router = new Router()
  const netEngineMill: NetEngineMill = new NetEngineMill(router, Number(conf_quorum))

  router.setId(conf_node_id)
  router.createRealm = (): BaseRealm => new BaseRealm(router, new NetEngine(netEngineMill))
  router.setLogTrace(true)

  listenHyperNetServer(new FoxGate(router), { port: Number(conf_fox_port) })
  netEngineMill.once(INIT_ADVANCE_SEGMENTS_COMPLETED, () => {
    new WampServer(new WampGate(router), { port: Number(conf_wamp_port) })
    listenMqttServer(new MqttGate(router), { port: Number(conf_mqtt_port) })
    console.log('=> INIT_ADVANCE_SEGMENTS_COMPLETED, listening WAMP:', conf_wamp_port, 'MQTT:', conf_mqtt_port)
  })
  console.log('ENTRY_ID:', conf_node_id, 'listening FOX:', conf_fox_port)
}

main().catch(err => {
  console.error('Error in main:', err)
  process.exit(1)
})
