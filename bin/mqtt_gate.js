const http = require('http')
const url = require('url')
const program = require('commander')
const Router = require('../index')
const MSG = require('../lib/messages')

program
  .option('-p, --http <port>', 'HTTP Server IP port', 9000)
  .option('-q, --mqtt <port>', 'MQTT Server IP port', 1883)
  .parse(process.argv)

let router = new Router()
router.setLogTrace(true)

router.on(MSG.REALM_CREATED, function (realm, realmName) {
  console.log('new Relm:', realmName)
})

router.getRealm('realm1', function (realm) {
  var api = realm.wampApi()
  api.register('test.foo', function (id, args, kwargs) {
    console.log('called with ', args, kwargs)
    api.resrpc(id, null /* no error */, ['bar', 'bar2'], { 'key1': 'bar1', 'key2': 'bar2' })
  })
})

router.listenMQTT({ port: program.mqtt })
console.log('MQTT Listening port', program.mqtt)

const wssWAMP = router.listenWAMP({ noServer: true })
console.log(`WAMP Web Socket ws://localhost:${program.http}:/wamp`)

const wssMQTT = router.listenWsMQTT({ noServer: true })
console.log(`MQTT Web Socket ws://localhost:${program.http}:/mqtt`)

let httpServer = http.createServer(function (req, res) {
  res.writeHead(200, { 'Content-Type': 'text/html' })
  console.log(req.headers)
  res.end('hello!')
})

httpServer.listen(program.http, () => console.log(`HTTP Server Listening on ${program.http}`))

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
