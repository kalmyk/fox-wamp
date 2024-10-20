'use strict'

const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const autobahn = require('autobahn')
const { QuorumEdge } = require('../lib/allot/quorum_edge')
const { mergeMin, mergeMax, makeEmpty } = require('../lib/allot/makeid')
const { EntrySession } = require('../lib/allot/entry_session')
const { History } = require('../lib/sqlite/history')
const { SqliteModKv } = require('../lib/sqlite/sqlitekv')
const Router = require('../lib/router')

const syncMass = new Map()
const gateMass = new Map()

let maxId = makeEmpty(new Date())

const runQuorum = new QuorumEdge((advanceSegment, value) => {
  console.log('SYNC:', advanceSegment, '=>', value)
  for (let [,ss] of syncMass) {
    ss.publish('syncId', [], {maxId, advanceSegment, syncId: value})
  }
}, mergeMin)

const readyQuorum = new QuorumEdge((advanceSegment, segmentId) => {
  for (let gg of gateMass.values()) {
    gg.commitSegment(advanceSegment, segmentId)
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

    session.subscribe('draftSegmentId', (args, kwargs, opts) => {
      console.log('draftSegmentId', ssId, kwargs)
      runQuorum.vote(ssId, kwargs.applicantId, kwargs.runId)
      maxId = mergeMax(maxId, kwargs.runId)
    })

    session.subscribe('commitSegment', (args, kwargs, opts) => {
      console.log('commitSegment', ssId, kwargs)
      readyQuorum.vote(ssId, kwargs.advanceSegment, kwargs.readyId)
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

function mkGate(uri, gateId, history, modKv, heapApi) {
  const connection = new autobahn.Connection({url: uri, realm: 'sys'})

  connection.onopen = function (session, details) {
    console.log('Gate session open', gateId, uri)
    gateMass.set(
      gateId,
      new EntrySession(session, syncMass, history, gateId, (advanceSegment, segment, effectId) => {
        const readyEvent = []
        const heapEvent = []
        for (let i = 0; i<segment.content.length; i++) {
          const event = segment.content[i]
          event.qid = effectId[i]
          if (event.opt.trace) {
            heapEvent.push(event)
          } else {
            readyEvent.push(event)
          }
        }
        for (const gg of gateMass.values()) {
          gg.publishSegment(segment)
        }
        session.publish('ackSegment', [], {advanceSegment, pkg: readyEvent})

        modKv.applySegment(heapEvent, (kind, outEvent) => {
          heapApi.publish('heapEvent', outEvent)
          session.publish('dispatchEvent', [], outEvent)
          console.log('heapEvent', outEvent)
        }).then(() => {
          // session.publish('final-segment', [], {advanceSegment})
        })
      })
    )
  }

  connection.onclose = function (reason, details) {
    console.log('Gate disconnected '+gateId, reason, details)
    gateMass.delete(gateId)
  }
  
  connection.open()
}

async function main () {
  const db = await sqlite.open({
    filename: conf_db_file,
    driver: sqlite3.Database
  })

  const history = new History(db)
  await history.createTables()

  const modKv = new SqliteModKv(db)
  await modKv.createTables()

  const router = new Router()
  const heap = router.getRealm('heap')
  
  mkSync('ws://127.0.0.1:9021/wamp', 1)
  mkSync('ws://127.0.0.1:9022/wamp', 2)
  mkSync('ws://127.0.0.1:9023/wamp', 3)
  
  mkGate('ws://127.0.0.1:9031/wamp', 1, history, modKv, heap.api())
  mkGate('ws://127.0.0.1:9032/wamp', 2, history, modKv, heap.api())
  mkGate('ws://127.0.0.1:9033/wamp', 3, history, modKv, heap.api())
}

main().then(() => {
  console.log('DONE.')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
