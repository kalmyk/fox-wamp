//
// This is demonstration how to integrate HTTP server
// with two sockets listeners, WAMP & MQTT
//
const http = require('http')
const url = require('url')
const program = require('commander')
const Router = require('../index')
const MSG = require('../lib/messages')

program
  .option('-p, --http <port>', 'HTTP Server IP port', 9000)
  .option('-q, --mqtt <port>', 'MQTT Server IP port', 1883)
  .parse(process.argv)

const router = new Router()
router.setLogTrace(true)

router.on(MSG.REALM_CREATED, function (realm, realmName) {
  console.log('new Relm:', realmName)
})

router.listenMQTT({ port: program.mqtt })
console.log('MQTT Listening port', program.mqtt)

const wssWAMP = router.listenWAMP({ noServer: true })
console.log(`WAMP Web Socket ws://localhost:${program.http}/wamp`)

const wssMQTT = router.listenWsMQTT({ noServer: true })
console.log(`MQTT Web Socket ws://localhost:${program.http}/mqtt`)

const httpServer = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  console.log(req.headers)
  res.end('Hello from Fox-WAMP server!')
})

httpServer.listen(program.http, () => console.log(`HTTP Server Listening on ${program.http}`))

// share same socket between two listeners
// https://github.com/websockets/ws/pull/885
httpServer.on('upgrade', (request, socket, head) => {
  const pathname = url.parse(request.url).pathname

  if (pathname === '/wamp') {
    wssWAMP.handleUpgrade(request, socket, head, (ws) => {
      wssWAMP.emit('connection', ws)
    })
  } else if (pathname === '/mqtt') {
    wssMQTT.handleUpgrade(request, socket, head, (ws) => {
      wssMQTT.emit('connection', ws)
    })
  } else {
    socket.destroy()
  }
})
