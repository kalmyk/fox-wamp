const conf_db_file = process.env.DB_FILE
  || console.log('DB_FILE must be defined') || process.exit(1)

const conf_config_file = process.env.CONFIG
  || console.log('CONFIG file name must be defined') || process.exit(1)

const autobahn = require('autobahn')

import { QuorumEdge } from '../lib/masterfree/quorum_edge.js'
import { mergeMax } from '../lib/masterfree/makeid.js'
import { SessionEntryHistory } from '../lib/masterfree/session_entry_history.js'
import { ProduceId } from '../lib/masterfree/makeid.js'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv.js'
import Router from '../lib/router.js'
import Config from '../lib/masterfree/config.js'
import { initDbFactory } from '../lib/sqlite/dbfactory.js'
import { StorageTask } from '../lib/masterfree/storage.js'
import { INTRA_REALM_NAME } from '../lib/masterfree/netengine.h'

const router = new Router()
const sysRealm = await router.getRealm(INTRA_REALM_NAME)

const storageTask = new StorageTask(sysRealm)

const runQuorum = new QuorumEdge((advanceSegment, value) => {
  console.log('runQuorum:', storageTask.getMaxId(), advanceSegment, '=>', value)
  for (let [,ss] of syncMass) {
    ss.publish('syncId', [], {maxId: storageTask.getMaxId(), advanceSegment, syncId: value})
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
      storageTask.setMaxId(mergeMax(maxId, kwargs.runId))
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
  const makeId = new ProduceId(() => keyDate(new Date()))
  const dbFactory = await initDbFactory()
  const db = await dbFactory.openMainDatabase(conf_db_file)
  const config = Config.getInstance()

  const modKv = new SqliteKvFabric(dbFactory, makeId)

  for (const sync of config.getSyncNodes()) {
    mkSync(sync.url, sync.nodeId)
  }
  for (const entry of config.getEntryNodes()) {
    mkGate(entry.url, entry.nodeId, modKv, sysRealm.api())
  }
}

Config.getInstance().loadConfigFile(conf_config_file).then(() => {
  main()
  console.log('connect function started')
}, (err) => {
  console.error('ERROR:', err, err.stack)
})
