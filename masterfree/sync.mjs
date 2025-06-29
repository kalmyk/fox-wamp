const conf_wamp_port = process.env.WAMP_PORT
  || console.log('WAMP_PORT must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

import Router from '../lib/router.js'
import {BaseRealm, BaseEngine} from '../lib/realm.js'
import { WampGate } from '../lib/wamp/gate.js'
import WampServer from '../lib/wamp/transport.js'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import Config from '../lib/masterfree/config.js'

const app = new Router()

Config.getInstance().loadConfigFile(conf_config_file).then(async () => {
  const sysRealm = new BaseRealm(app, new BaseEngine())
  await app.initRealm('sys', sysRealm)
  const stageOneTask = new StageOneTask(sysRealm, Config.getInstance().getMajorLimit())
  stageOneTask.startActualizePrefixTimer()

  /*const server = */new WampServer(new WampGate(app), { port: conf_wamp_port })
  console.log('Listening WAMP port:', conf_wamp_port)
})
