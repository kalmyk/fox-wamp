import http from 'http'
import url from 'url'
import * as MSG from '../lib/messages'
import FoxRouter from '../lib/fox_router'
import { BaseRealm } from '../lib/realm'
import program from 'commander'

program
  .option('-p, --http <port>', 'HTTP Server IP port', '9000')
  .option('-q, --mqtt <port>', 'MQTT Server IP port', '1883')
  .parse(process.argv)

const router = new FoxRouter()
router.setLogTrace(true)

router.on(MSG.REALM_CREATED, (_realm: BaseRealm, realmName: string) => {
  console.log('new Realm:', realmName)
})

router.listenMQTT({ port: program.mqtt })
console.log('MQTT Listening port', program.mqtt)

const wssWAMP = router.listenWAMP({ noServer: true })
console.log(`WAMP Web Socket ws://localhost:${program.http}/wamp`)

const wssMQTT = router.listenWsMQTT({ noServer: true })
console.log(`MQTT Web Socket ws://localhost:${program.http}/mqtt`)

const httpServer = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  console.log(req.headers)
  res.end('Hello from Fox-WAMP server!')
})

httpServer.listen(program.http, () => console.log(`HTTP Server Listening on ${program.http}`))

httpServer.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url ?? '').pathname

  if (pathname === '/wamp') {
    wssWAMP.handleUpgrade(request, socket, head, (ws: any) => {
      wssWAMP.emit('connection', ws)
    })
  } else if (pathname === '/mqtt') {
    wssMQTT.handleUpgrade(request, socket, head, (ws: any) => {
      wssMQTT.emit('connection', ws)
    })
  } else {
    socket.destroy()
  }
})
