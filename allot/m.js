'use strict'

const autobahn = require('autobahn')
const {QuorumEdge} = require('../lib/allot/quorum_edge')
const {mergeMin, mergeMax, makeEmpty} = require('../lib/allot/makeid')

const syncMass = new Map()
const gateMass = new Map()

let maxId = makeEmpty(new Date())

const runQuorum = new QuorumEdge((bundleId, value) => {
  console.log('SYNC:', bundleId, '=>', value)
  for (let [,ss] of syncMass) {
    ss.publish('syncId', [], {maxId, bundleId, syncId: value})
  }
}, mergeMin)

const readyQuorum = new QuorumEdge((bundleId, syncId) => {
  console.log('READY:', bundleId, '=>', syncId)
  for (let [,gg] of gateMass) {
    gg.done(bundleId, syncId)
  }
}, mergeMin)

function mkSync(uri, ssId) {
  console.log('connect to sync:', ssId, uri)
  const connection = new autobahn.Connection({url: uri, realm: 'ctrl'})

  connection.onopen = function (session, details) {
    session.log('Session open', ssId)
    syncMass.set(ssId, session)
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
    syncMass.delete(ssId)
    runQuorum.delMember(ssId)
    readyQuorum.delMember(ssId)
  }
  
  connection.open()
}

class GateSession {
  constructor (session) {
    this.session = session
    this.stack = []
    this.waitForValue = undefined

    session.subscribe('mkId', (publishArgs, kwargs, opts) => {
      this.sync(kwargs.bundleId)
    })

    session.subscribe('ping', (publishArgs, kwargs, opts) => {
      session.publish('pong', publishArgs, kwargs)
    })
  }

  sendToSync(bundleId) {
    console.log('mkId', bundleId)
    for (let [,ss] of syncMass) {
      ss.publish('mkId', [], {bundleId})
    }
  }

  checkLine() {
    if (this.waitForValue) {
      return false
    }
    this.waitForValue = this.stack.shift()
    if (this.waitForValue) {
      this.sendToSync(this.waitForValue)
      return true
    }
    return false
  }

  sync(bundleId) {
    this.stack.push(bundleId)
    return this.checkLine()
  }

  done(bundleId, syncId) {
    if (this.waitForValue === bundleId) {
      this.session.publish('readyId', [], {bundleId, syncId})
      return this.checkLine()
    }
    return false
  }
}

function mkGate(uri, gateId) {
  console.log('connect to gate:', uri)
  const connection = new autobahn.Connection({url: uri, realm: 'gate'})

  connection.onopen = function (session, details) {
    session.log('Session open '+gateId)
    gateMass.set(gateId, new GateSession(session))
  }

  connection.onclose = function (reason, details) {
    console.log('disconnected '+gateId, reason, details)
    gateMass.delete(gateId)
  }
  
  connection.open()
}

mkSync('ws://127.0.0.1:9011/wamp', 1)
mkSync('ws://127.0.0.1:9012/wamp', 2)
mkSync('ws://127.0.0.1:9013/wamp', 3)

mkGate('ws://127.0.0.1:9021/wamp', 1)
mkGate('ws://127.0.0.1:9022/wamp', 2)
mkGate('ws://127.0.0.1:9023/wamp', 3)
