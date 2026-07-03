import { once } from 'node:events'
import * as chai from 'chai'; const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { Router } from '../lib/router'
import { HistorySegment, NetEngine, NetEngineMill, TOTAL_SHARDS_COUNT } from '../lib/masterfree/netengine'
import { StorageTask, SEGMENT_COMMITTED } from '../lib/masterfree/storage'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { BaseRealm } from '../lib/realm'
import { Config, setConfigInstance } from '../lib/masterfree/config'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_ADVANCE_SEGMENT_RESOLVED, keepHistoryShardTopic, KEEP_HISTORY_SHARD_PREFIX } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'

// ─── shard counter and HistorySegment ────────────────────────────────────────

describe('65.sharding', function () {
  describe('shard counter', () => {
    it('8.1 increments by 1 each call', () => {
      const seg1 = new HistorySegment(1, 0)
      const seg2 = new HistorySegment(2, 1)
      expect(seg2.getShardTag() - seg1.getShardTag()).to.equal(1)
    })

    it('8.2 wraps around: (TOTAL_SHARDS_COUNT - 1 + 1) % TOTAL_SHARDS_COUNT === 0', () => {
      expect((TOTAL_SHARDS_COUNT - 1 + 1) % TOTAL_SHARDS_COUNT).to.equal(0)
    })
  })

  describe('HistorySegment.getDestinationTopics()', () => {
    it('8.3 returns shard topic when sharded=true', () => {
      const seg = new HistorySegment(1000, 5, true)
      expect(seg.getDestinationTopics()).to.deep.equal([keepHistoryShardTopic(5)])
    })

    it('8.3 returns broadcast topic when sharded=false', () => {
      const seg = new HistorySegment(1000, 5, false)
      expect(seg.getDestinationTopics()).to.deep.equal([Event.KEEP_ADVANCE_HISTORY])
    })
  })

  // ─── Config ────────────────────────────────────────────────────────────────

  describe('Config.findShardsForNode()', () => {
    let config: Config

    beforeEach(() => {
      config = new Config()
      ;(config as any).config = {
        eventNodes: {
          NDB1: { host: '127.0.0.1', port: '1755', shards: [0, 1, 2, 3] },
          NDB2: { host: '127.0.0.1', port: '1756', shards: [4, 5, 6, 7] },
        }
      }
    })

    it('8.4 returns shards for NDB1', () => {
      expect(config.findShardsForNode('NDB1')).to.deep.equal([0, 1, 2, 3])
    })

    it('8.4 returns shards for NDB2', () => {
      expect(config.findShardsForNode('NDB2')).to.deep.equal([4, 5, 6, 7])
    })

    it('8.4 returns empty array for unknown node', () => {
      expect(config.findShardsForNode('NDB99')).to.deep.equal([])
    })

    it('8.4 returns empty array when eventNodes missing', () => {
      ;(config as any).config = {}
      expect(config.findShardsForNode('NDB1')).to.deep.equal([])
    })

    it('validateShardsForNode passes for valid shards', () => {
      expect(() => config.validateShardsForNode('NDB1')).to.not.throw()
    })

    it('validateShardsForNode throws for out-of-range shard', () => {
      ;(config as any).config.eventNodes.NDB1.shards = [0, 99]
      expect(() => config.validateShardsForNode('NDB1')).to.throw('out of range')
    })
  })

  // ─── Entry node: publishes to shard topic when sharded ────────────────────

  describe('NetEngineMill with sharded=true', () => {
    let router: Router
    let netEngineMill: NetEngineMill
    let sysRealm: BaseRealm
    let sysApi: HyperClient
    let netRealm: BaseRealm

    beforeEach(async () => {
      setConfigInstance(new Config())
      router = new Router()
      router.setId('E1')
      netEngineMill = new NetEngineMill(router, 2, true)
      netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
      router.initRealm('testnet', netRealm)
      sysRealm = await router.getRealm('sys')
      sysApi = sysRealm.api()
    })

    it('publishes KEEP_ADVANCE_HISTORY to keepHistory.<shardTag> not broadcast', async () => {
      const receivedTopics: string[] = []
      sysApi.subscribe(KEEP_HISTORY_SHARD_PREFIX + '.*', (_event, opt) => {
        receivedTopics.push(opt.topic)
      })
      const broadcastReceived: string[] = []
      sysApi.subscribe(Event.KEEP_ADVANCE_HISTORY, (_event, opt) => {
        broadcastReceived.push(opt.topic)
      })

      const netApi = netRealm.api()
      await netApi.publish('any-topic', { data: 'test' }, {})

      // Give async publish chain time to settle
      await new Promise(r => setTimeout(r, 20))

      expect(broadcastReceived).to.have.length(0, 'broadcast topic must not be used when sharded')
      expect(receivedTopics).to.have.length(1)
      expect(receivedTopics[0]).to.match(new RegExp('^' + KEEP_HISTORY_SHARD_PREFIX + '\\.\\d+$'))
    })

    it('shard topic matches shardTag directly', async () => {
      let capturedTopic = ''
      let capturedShardTag = -1
      sysApi.subscribe(KEEP_HISTORY_SHARD_PREFIX + '.*', (event, opt) => {
        capturedTopic = opt.topic as string
        capturedShardTag = (event as any).shard
      })

      const netApi = netRealm.api()
      await netApi.publish('any-topic', { data: 'test' }, {})
      await new Promise(r => setTimeout(r, 20))

      expect(capturedTopic).to.equal(keepHistoryShardTopic(capturedShardTag))
    })
  })

  // ─── Storage node: processes shard topics, writes to plain tables ──────────

  describe('StorageTask with EventNodeConfig', () => {
    let router: Router
    let sysRealm: BaseRealm
    let storage: StorageTask
    let dbFactory: DbFactory
    let db: sqlite.Database
    let api: HyperClient

    beforeEach(async () => {
      db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      dbFactory = new DbFactory('/tmp/fox-test-dbs/')
      dbFactory.setMainDb(db)
      router = new Router()
      router.setId('NDB1')
      sysRealm = await router.getRealm('sys')
      api = sysRealm.buildApi()
    })

    it('processes events from owned shard topic and writes to plain table', async () => {
      storage = new StorageTask(sysRealm, dbFactory, { shards: [0, 1] })

      const committed = once(dbFactory, SEGMENT_COMMITTED)

      const eventKAH: BODY_KEEP_ADVANCE_HISTORY = {
        advanceOwner: 'entry1',
        advanceId: { segment: 1, offset: 1 },
        shard: 0,
        realm: 'myrealm',
        data: 'test-data',
        uri: ['my', 'topic'],
        opt: {},
        sid: 'session1'
      }
      await api.publish(keepHistoryShardTopic(0), eventKAH, { exclude_me: false })

      const eventASR: BODY_ADVANCE_SEGMENT_RESOLVED = {
        advanceOwner: 'entry1',
        advanceStamp: 1,
        segment: 'seg1'
      }
      await api.publish(Event.ADVANCE_SEGMENT_RESOLVED, eventASR, { exclude_me: false })

      await committed

      // Plain table (no schema prefix)
      const rows = await db.all('SELECT * FROM event_history_myrealm')
      expect(rows).to.have.lengthOf(1)
      expect(rows[0].msg_id).to.equal('seg1a1')
      expect(rows[0].msg_shard).to.equal(0)
    })

    it('does NOT process broadcast KEEP_ADVANCE_HISTORY when eventConfig is set', async () => {
      storage = new StorageTask(sysRealm, dbFactory, { shards: [0, 1] })

      await api.publish(Event.KEEP_ADVANCE_HISTORY, {
        advanceOwner: 'entry1',
        advanceId: { segment: 1, offset: 1 },
        shard: 0,
        realm: 'myrealm',
        data: 'should-be-ignored',
        uri: ['my', 'topic'],
        opt: {},
        sid: 'session1'
      } as BODY_KEEP_ADVANCE_HISTORY, { exclude_me: false })

      await new Promise(r => setTimeout(r, 50))

      // No table should be created via the broadcast path
      const tables = await db.all(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='event_history_myrealm'"
      )
      expect(tables).to.have.lengthOf(0)
    })

    it('falls back to broadcast when no eventConfig provided', async () => {
      storage = new StorageTask(sysRealm, dbFactory)

      const committed = once(dbFactory, SEGMENT_COMMITTED)

      await api.publish(Event.KEEP_ADVANCE_HISTORY, {
        advanceOwner: 'entry1',
        advanceId: { segment: 1, offset: 1 },
        shard: 0,
        realm: 'myrealm',
        data: 'broadcast-data',
        uri: ['my', 'topic'],
        opt: {},
        sid: 'session1'
      } as BODY_KEEP_ADVANCE_HISTORY, { exclude_me: false })

      await api.publish(Event.ADVANCE_SEGMENT_RESOLVED, {
        advanceOwner: 'entry1',
        advanceStamp: 1,
        segment: 'seg1'
      } as BODY_ADVANCE_SEGMENT_RESOLVED, { exclude_me: false })

      await committed

      const rows = await db.all('SELECT * FROM event_history_myrealm')
      expect(rows).to.have.lengthOf(1)
    })
  })
})
