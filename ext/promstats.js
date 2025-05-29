'use strict'

const client = require('prom-client')
const { SESSION_TX, SESSION_RX } = require('../lib/messages')

let program

// Prometheus metrics
const txCount = new client.Counter({
  name: 'tx_count',
  help: 'Number of transmitted messages',
  labelNames: ['realm', 'gate'],
})

const txSize = new client.Counter({
  name: 'tx_size',
  help: 'Total size of transmitted messages',
  labelNames: ['realm', 'gate'],
})

const rxCount = new client.Counter({
  name: 'rx_count',
  help: 'Number of received messages',
  labelNames: ['realm', 'gate'],
})

const rxSize = new client.Counter({
  name: 'rx_size',
  help: 'Total size of received messages',
  labelNames: ['realm', 'gate'],
})

function init(options) {
  program = options
  program
    .option('-t, --prom-port <port>', 'Prometheus metrics server port', 9100)
}

function traceRouter(router) {
  // Start Prometheus metrics server
  const port = program.promPort || 9100
  const http = require('http')
  http.createServer((req, res) => {
    if (req.url === '/metrics') {
      res.setHeader('Content-Type', client.contentType)
      client.register.metrics().then(data => res.end(data))
    } else {
      res.statusCode = 404
      res.end()
    }
  }).listen(port)

  const collectDefaultMetrics = client.collectDefaultMetrics
  const prefix = 'fox_'
  collectDefaultMetrics({ prefix })

  router.on(SESSION_TX, function (session, data) {
    let realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }
    txCount.inc({ realm: realmName, gate: session.getGateProtocol() }, 1)
    txSize.inc({ realm: realmName, gate: session.getGateProtocol() }, data.length)
  })

  router.on(SESSION_RX, function (session, data) {
    let realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }
    rxCount.inc({ realm: realmName, gate: session.getGateProtocol() }, 1)
    rxSize.inc({ realm: realmName, gate: session.getGateProtocol() }, data.length)
  })
}

exports.init = init
exports.traceRouter = traceRouter
