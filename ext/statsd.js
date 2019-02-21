'use strict'

const StatsD = require('node-statsd')

function init (program) {
  program
    .option('-t, --statsd-port <port>', 'StatsD Server IP port', 8125)
    .option('-s, --statsd-host <ip>', 'StatsD Server IP', 'localhost')
}

function TraceRouter (program, router) {
  let client = new StatsD({
    host: program.statsdServer,
    port: program.statsdPort,
    prefix: 'fox.'
  })

  router.on('session.Tx', function (session, data) {
    var realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }

    client.increment(realmName + '.Tx.count', 1)
    client.increment(realmName + '.Tx.size', data.length)
  })

  router.on('session.Rx', function (session, data) {
    var realmName = 'UNKNOWN'
    if (session.realm) {
      realmName = session.getRealmName()
    }

    client.increment(realmName + '.Rx.count', 1)
    client.increment(realmName + '.Rx.size', data.length)
  })
}

exports.init = init
exports.TraceRouter = TraceRouter
