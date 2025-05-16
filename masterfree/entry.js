'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_fox_port = process.env.FOX_PORT
  || console.log('FOX_PORT must be defined') || process.exit(1)

const conf_node_id = process.env.NODE_ID
  || console.log('NODE_ID must be defined') || process.exit(1)

const Router = require('../lib/router')
const { BaseRealm } = require('../lib/realm')
const { WampGate } = require('../lib/wamp/gate')
const { FoxGate } = require('../lib/hyper/gate')
const { FoxNetServer } = require('../lib/hyper/net_transport')
const WampServer = require('../lib/wamp/transport')
const MqttServer = require('../lib/mqtt/transport')
const { NetEngine, NetEngineMill } = require('../lib/allot/netengine')
const { MqttGate } = require('../lib/mqtt/gate')

const router = new Router()
const netEngineMill = new NetEngineMill(router)

router.setId(conf_node_id)
router.createRealm = () => new BaseRealm(router, new NetEngine(netEngineMill))

new WampServer(new WampGate(router), { port: conf_wamp_port })
new MqttServer(new MqttGate(router), { port: conf_mqtt_port })
new FoxNetServer(new FoxGate(router), { port: conf_fox_port })

console.log('at NODE_ID:', conf_node_id, 'listening WAMP:', conf_wamp_port, 'MQTT:', conf_mqtt_port, 'FOX:', conf_fox_port)
