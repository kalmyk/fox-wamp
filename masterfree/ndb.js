'use strict'

const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const autobahn = require('autobahn')

const { QuorumEdge } = require('../lib/allot/quorum_edge')
const { mergeMin, mergeMax, makeEmpty } = require('../lib/allot/makeid')
const { SessionEntryHistory } = require('../lib/allot/session_entry_history')
const { SqliteModKv } = require('../lib/sqlite/sqlitekv')
const Router = require('../lib/router')
const config = require('./config').getInstance()
const { initDbFactory } = require('../lib/sqlite/dbfactory')

const syncMass = new Map()
const gateMass = new Map()

let maxId = makeEmpty(new Date())

const runQuorum = new QuorumEdge((advanceSegment, value) => {
  console.log('runQuorum:', maxId, advanceSegment, '=>', value)
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
  const connection = new autobahn.Connection({url: uri, realm: 'sys'})

  connection.onopen = function (session, details) {
    console.log('sync session open', ssId, uri)
    syncMass.set(ssId, session)
    runQuorum.addMember(ssId)
    readyQuorum.addMember(ssId)

    session.subscribe('draftSegmentId', (args, kwargs, opts) => {
      console.log('=> draftSegmentId', ssId, args, kwargs)
      runQuorum.vote(ssId, kwargs.applicantId, kwargs.runId)
      maxId = mergeMax(maxId, kwargs.runId)
    })

    session.subscribe('commitSegment', (args, kwargs, opts) => {
      console.log('=> commitSegment', ssId, args, kwargs)
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

function mkGate(uri, gateId, modKv, heapApi) {
  const connection = new autobahn.Connection({url: uri, realm: 'sys'})

  connection.onopen = function (session, details) {
    console.log('connect gate', gateId, uri)
    gateMass.set(
      gateId,
      new SessionEntryHistory(session, syncMass, gateId, (advanceSegment, segment, effectId) => {
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
        session.publish('advance-segment-resolved', [], {advanceSegment, pkg: readyEvent})

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
  const dbFactory = await initDbFactory()
  const db = await dbFactory.openMainDatabase(conf_db_file)

  const modKv = new SqliteModKv()

  const router = new Router()
  const heap = await router.getRealm('heap')

  for (const sync of config.getSyncNodes()) {
    mkSync(sync.url, sync.nodeId)
  }
  for (const entry of config.getEntryNodes()) {
    mkGate(entry.url, entry.nodeId, modKv, heap.api())
  }
}

config.loadConfigFile(conf_config_file).then(() => {
  main()
  console.log('connect function started')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
