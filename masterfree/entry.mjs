const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_fox_port = process.env.FOX_PORT
  || console.log('FOX_PORT must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import Router from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { WampGate } from '../lib/wamp/gate'
import { FoxGate } from '../lib/hyper/gate'
import { listenHyperNetServer } from '../lib/hyper/net_transport'
import WampServer from '../lib/wamp/transport'
import listenMqttServer from '../lib/mqtt/transport'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { MqttGate } from '../lib/mqtt/gate'

const router = new Router()
const netEngineMill = new NetEngineMill(router)

router.setId(conf_node_id)
router.createRealm = () => new BaseRealm(router, new NetEngine(netEngineMill))
router.setLogTrace(true)

new WampServer(new WampGate(router), { port: conf_wamp_port })
listenMqttServer(new MqttGate(router), { port: conf_mqtt_port })
listenHyperNetServer(new FoxGate(router), { port: conf_fox_port })

console.log('ENTRY_ID:', conf_node_id, 'listening WAMP:', conf_wamp_port, 'MQTT:', conf_mqtt_port, 'FOX:', conf_fox_port)
