const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_fox_port = process.env.FOX_PORT
  || console.log('FOX_PORT must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

import Router from '../lib/router.js'
import { BaseRealm } from '../lib/realm.js'
import { WampGate } from '../lib/wamp/gate.js'
import { FoxGate } from '../lib/hyper/gate.js'
import { FoxNetServer } from '../lib/hyper/net_transport.js'
import WampServer from '../lib/wamp/transport.js'
import MqttServer from '../lib/mqtt/transport.js'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine.js'
import { MqttGate } from '../lib/mqtt/gate.js'

const router = new Router()
const netEngineMill = new NetEngineMill(router)

router.setId(conf_node_id)
router.createRealm = () => new BaseRealm(router, new NetEngine(netEngineMill))

new WampServer(new WampGate(router), { port: conf_wamp_port })
new MqttServer(new MqttGate(router), { port: conf_mqtt_port })
new FoxNetServer(new FoxGate(router), { port: conf_fox_port })

console.log('at NODE_ID:', conf_node_id, 'listening WAMP:', conf_wamp_port, 'MQTT:', conf_mqtt_port, 'FOX:', conf_fox_port)
