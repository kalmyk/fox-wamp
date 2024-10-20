'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_mqtt_port = process.env.MQTT_PORT
  || console.log('MQTT_PORT must be defined') || process.exit(1)

const conf_id = process.env.ID
  || console.log('ID must be defined') || process.exit(1)

const Router = require('../lib/router')
const { BaseRealm } = require('../lib/realm')
const { WampGate } = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')
const MqttServer = require('../lib/mqtt/transport')
const { NetBinder, NetEngine } = require('../lib/allot/netbinder')
const { MqttGate } = require('../lib/mqtt/gate')

const router = new Router()
const binder = new NetBinder(router)

router.setId(conf_id)
router.createRealm = () => new BaseRealm(router, new NetEngine(binder))

new WampServer(new WampGate(router), { port: conf_wamp_port })
new MqttServer(new MqttGate(router), { port: conf_mqtt_port })

console.log('Listening WAMP port:', conf_wamp_port)
