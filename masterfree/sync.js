'use strict'

const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const autobahn = require('autobahn')

const Router = require('../lib/router')
const {BaseRealm, BaseEngine} = require('../lib/realm')
const { WampGate } = require('../lib/wamp/gate')
const WampServer = require('../lib/wamp/transport')
const { SessionEntrySync } = require('../lib/masterfree/session_entry_sync')
const config = require('../lib/masterfree/config').getInstance()

const app = new Router()
const gateMass = new Map()

function mkGate(uri, gateId) {
  const connection = new autobahn.Connection({url: uri, realm: 'sys'})

  connection.onopen = function (session, details) {
    console.log('connect gate', gateId, uri)
    gateMass.set(
      gateId,
      new SessionEntrySync(session)
    )
  }

  connection.onclose = function (reason, details) {
    console.log('gate disconnected '+gateId, reason, details)
    gateMass.delete(gateId)
  }
  
  connection.open()
}

config.loadConfigFile(conf_config_file).then(async () => {
  const sysRealm = new BaseRealm(app, new BaseEngine())
  await app.initRealm('sys', sysRealm)
  const synchronizer = new Synchronizer(sysRealm)
  synchronizer.startActualizePrefixTimer()

  /*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
  console.log('Listening WAMP port:', conf_wamp_port)

  for (const entry of config.getEntryNodes()) {
    mkGate(entry.url, entry.nodeId)
  }
})
