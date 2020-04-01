'use strict'

const StatsD = require('node-statsd')
const { SESSION_TX, SESSION_RX } = require('../lib/messages')

let program

function init (options) {
  program = options
  program
    .option('-t, --statsd-port <port>', 'StatsD Server IP port', 8125)
    .option('-s, --statsd-host <ip>', 'StatsD Server IP', 'localhost')
}

function traceRouter (router) {
  let client = new StatsD({
    host: program.statsdServer,
    port: program.statsdPort,
    prefix: 'fox.'
  })

  router.on(SESSION_TX, function (session, data) {
    var realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }

    client.increment(realmName + '.Tx.count', 1)
    client.increment(realmName + '.Tx.size', data.length)
  })

  router.on(SESSION_RX, function (session, data) {
    var realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }

    client.increment(realmName + '.Rx.count', 1)
    client.increment(realmName + '.Rx.size', data.length)
  })
}

exports.init = init
exports.traceRouter = traceRouter
