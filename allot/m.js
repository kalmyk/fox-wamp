'use strict'

const autobahn = require('autobahn')
const {QuorumEdge} = require('../lib/allot/quorum_edge')
const {mergeMin, mergeMax, makeEmpty} = require('../lib/allot/makeid')

const sync = new Map()
const gate = new Map()

let maxId = makeEmpty(new Date())

const runQuorum = new QuorumEdge((bundleId, value) => {
  console.log('SYNC:', bundleId, '=>', value)
  for (let [,ss] of sync) {
    ss.publish('syncId', [], {maxId, bundleId, syncId: value})
  }
}, mergeMin)

const readyQuorum = new QuorumEdge((bundleId, value) => {
  console.log('READY:', bundleId, '=>', value)
  for (let [,gg] of gate) {
    gg.publish('readyId', [], {bundleId, syncId: value})
  }
}, mergeMin)

function mkSync(uri, ssId) {
  console.log('connect to sync:', ssId, uri)
  const connection = new autobahn.Connection({url: uri, realm: 'ctrl'})

  connection.onopen = function (session, details) {
    session.log('Session open', ssId)
    sync.set(ssId, session)
    runQuorum.addMember(ssId)
    readyQuorum.addMember(ssId)

    session.subscribe('runId', (args, kwargs, opts) => {
      console.log('runId', ssId, kwargs)
      runQuorum.vote(ssId, kwargs.bundleId, kwargs.runId)
      maxId = mergeMax(maxId, kwargs.runId)
    })

    session.subscribe('readyId', (args, kwargs, opts) => {
      console.log('readyId', ssId, kwargs)
      readyQuorum.vote(ssId, kwargs.bundleId, kwargs.readyId)
    })
  }

  connection.onclose = function (reason, details) {
    console.log('disconnected '+ssId, reason, details)
    sync.delete(ssId)
    runQuorum.delMember(ssId)
    readyQuorum.delMember(ssId)
  }
  
  connection.open()
}

function mkGate(uri, gateId) {
  console.log('connect to gate:', uri)
  const connection = new autobahn.Connection({url: uri, realm: 'gate'})

  connection.onopen = function (session, details) {
    session.log('Session open '+gateId)
    gate.set(gateId, session)

    session.subscribe('mkId', (publishArgs, kwargs, opts) => {
      console.log('mkId', gateId, kwargs)
      for (let [,ss] of sync) {
        ss.publish('mkId', [], {bundleId: kwargs.bundleId})
      }
    })
  }

  connection.onclose = function (reason, details) {
    console.log('disconnected '+gateId, reason, details)
    gate.delete(gateId)
  }
  
  connection.open()
}

mkSync('ws://127.0.0.1:9011/wamp', 1)
mkSync('ws://127.0.0.1:9012/wamp', 2)
mkSync('ws://127.0.0.1:9013/wamp', 3)

mkGate('ws://127.0.0.1:9021/wamp', 1)
mkGate('ws://127.0.0.1:9022/wamp', 2)
mkGate('ws://127.0.0.1:9023/wamp', 3)
