'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_host_id = process.env.HOST_ID
  || console.log('HOST_ID must be defined') || process.exit(1)

const Router = require('../lib/router')
const {BaseRealm, BaseEngine} = require('../lib/realm')
const WampGate = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')

const app = new Router()
const realm = new BaseRealm(app, new BaseEngine())
app.addRealm('gate', realm)
const api = realm.foxApi()
/*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
console.log('Listening WAMP port:', conf_wamp_port)

api.subscribe(['readyId'], (data, opt) => {
  console.log('READY-ID', data, opt)
})

let cnt = 0
setInterval(
  ()=>{
    cnt++
    console.log('go', conf_host_id, cnt)
    api.publish(['mkId'], {kv: {bundleId: ''+conf_host_id+cnt}})
  },
  10000
)
