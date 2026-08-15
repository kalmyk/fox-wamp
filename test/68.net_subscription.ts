import { once } from 'node:events'

import * as chai from 'chai'; const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'
import { MemServer } from '../lib/hyper/mem_transport'
import { FoxGate } from '../lib/hyper/gate'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { EventStorageTask, SEGMENT_COMMITTED } from '../lib/masterfree/storage'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { NetSubStatusFactory, SharedSegmentBuffer } from '../lib/masterfree/net_sub'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_ADVANCE_SEGMENT_RESOLVED, HistoryEvent, HistoryFetchProgress } from '../lib/masterfree/hyper.h'
import { errorCodes, RealmError } from '../lib/realm_error'

async function commitSegment (
  api: HyperClient,
  dbFactory: DbFactory,
  opts: {
    shard: number
    realm: string
    advanceOwner: string
    advanceStamp: number
    segment: string
    events: Array<{ uri: string[], data: any, opt?: any }>
  }
): Promise<void> {
  for (let i = 0; i < opts.events.length; i++) {
    const e = opts.events[i]
    const kah: BODY_KEEP_ADVANCE_HISTORY = {
      advanceOwner: opts.advanceOwner,
      advanceId: { segment: opts.advanceStamp, offset: i + 1 },
      shard: opts.shard,
      realm: opts.realm,
      data: e.data,
      uri: e.uri,
      opt: e.opt || {},
      sid: 'session1'
    }
    await api.publish(Event.keepAdvanceHistoryTopic(opts.shard), kah, { exclude_me: false })
  }
  const committed = once(dbFactory, SEGMENT_COMMITTED)
  const asr: BODY_ADVANCE_SEGMENT_RESOLVED = {
    advanceOwner: opts.advanceOwner,
    advanceStamp: opts.advanceStamp,
    segment: opts.segment
  }
  await api.publish(Event.ADVANCE_SEGMENT_RESOLVED, asr, { exclude_me: false })
  await committed
}

function mkEvent (eventId: string, shardTag: number, uri: string[] = ['t']): HistoryEvent {
  return { eventId, shardTag, uri, data: eventId, opt: {} }
}

class FakeSysApi {
  calls = new Map<string, { progress: (p: any) => void, resolve: (v: any) => void, reject: (e: any) => void }>()

  callrpc (uri: string, _data: any, opt: any): Promise<any> {
    return new Promise((resolve, reject) => {
      this.calls.set(uri, { progress: opt.progress, resolve, reject })
    })
  }
}

describe('68.net_subscription', function () {

  // ─── fox.storage.history.fetch.<shardTag> RPC ────────────────────────────

  describe('fox.storage.history.fetch.<shardTag> RPC', () => {
    let router: Router
    let sysRealm: BaseRealm
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
      new EventStorageTask(sysRealm, dbFactory, { shards: [0, 1] }, router.getId())
      api = sysRealm.buildApi()
    })

    it('7.1 returns only the registered shard events, in event_id ASC order', async () => {
      await commitSegment(api, dbFactory, {
        shard: 0, realm: 'myapp', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [{ uri: ['a'], data: { kv: 'd1' } }, { uri: ['b'], data: { kv: 'd2' } }]
      })
      await commitSegment(api, dbFactory, {
        shard: 1, realm: 'myapp', advanceOwner: 'e1', advanceStamp: 2, segment: 'seg2',
        events: [{ uri: ['c'], data: { kv: 'd3' } }]
      })

      const progresses: HistoryFetchProgress[] = []
      const result = await api.callrpc(Event.historyFetchTopic(0), { realm: 'myapp', afterEventId: null }, {
        progress: (p: HistoryFetchProgress) => progresses.push(p)
      })

      expect(result).to.deep.equal({ done: true })
      const events = progresses.flatMap(p => p.events)
      expect(events.map(e => e.eventId)).to.deep.equal(['seg1a1', 'seg1a2'])
      expect(events.every(e => e.shardTag === 0)).to.be.true
    })

    it('7.2 afterEventId cursor returns only events after the cursor', async () => {
      await commitSegment(api, dbFactory, {
        shard: 0, realm: 'myapp', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [{ uri: ['a'], data: { kv: 'd1' } }, { uri: ['a'], data: { kv: 'd2' } }]
      })

      const progresses: HistoryFetchProgress[] = []
      await api.callrpc(Event.historyFetchTopic(0), { realm: 'myapp', afterEventId: 'seg1a1' }, {
        progress: (p: HistoryFetchProgress) => progresses.push(p)
      })

      const events = progresses.flatMap(p => p.events)
      expect(events.map(e => e.eventId)).to.deep.equal(['seg1a2'])
    })

    it('7.3 unknown realm returns { done: true } immediately, no progress calls', async () => {
      const progresses: HistoryFetchProgress[] = []
      const result = await api.callrpc(Event.historyFetchTopic(0), { realm: 'unknown', afterEventId: null }, {
        progress: (p: HistoryFetchProgress) => progresses.push(p)
      })
      expect(result).to.deep.equal({ done: true })
      expect(progresses).to.deep.equal([])
    })
  })

  // ─── NetSubStatusFactory ───────────────────────────────────────────────────

  describe('NetSubStatusFactory', () => {
    it('7.4 hasStorageNodes() becomes true after STORAGE_NODE_CONNECTED', async () => {
      const router = new Router()
      router.setId('E1')
      const sysRealm = await router.getRealm('sys')
      const sysApi = sysRealm.buildApi()
      const factory = new NetSubStatusFactory(sysApi)

      expect(factory.hasStorageNodes()).to.be.false

      await sysApi.publish(Event.STORAGE_NODE_CONNECTED, { nodeId: 'NDB1' }, { exclude_me: false })

      expect(factory.hasStorageNodes()).to.be.true
    })
  })

  // ─── SharedSegmentBuffer (unit-level, fake sysApi) ─────────────────────────

  describe('SharedSegmentBuffer', () => {
    it('7.5 merges events from two shards’ concurrent calls in event_id ASC order', async () => {
      const fake = new FakeSysApi()
      const buffer = new SharedSegmentBuffer()
      buffer.ensureLoading(fake as unknown as HyperClient, 'myapp', null)

      const call0 = fake.calls.get(Event.historyFetchTopic(0))!
      const call4 = fake.calls.get(Event.historyFetchTopic(4))!

      call0.progress({ events: [mkEvent('EVT_10', 0), mkEvent('EVT_20', 0)], lastEventId: 'EVT_20' })
      call4.progress({ events: [mkEvent('EVT_15', 4), mkEvent('EVT_25', 4)], lastEventId: 'EVT_25' })

      for (const [, call] of fake.calls) {
        call.resolve({ done: true })
      }

      const collected: string[] = []
      await buffer.drainUntil(null, ['t'], cmd => collected.push(cmd.qid))
      expect(collected).to.deep.equal(['EVT_10', 'EVT_15', 'EVT_20', 'EVT_25'])
    })

    it('7.10 all shards failing with ERROR_NO_SUCH_PROCEDURE still resolves (no hang, zero events)', async () => {
      const fake = new FakeSysApi()
      const buffer = new SharedSegmentBuffer()
      buffer.ensureLoading(fake as unknown as HyperClient, 'myapp', null)

      for (const [, call] of fake.calls) {
        call.reject(new RealmError('id', errorCodes.ERROR_NO_SUCH_PROCEDURE, 'no callee registered'))
      }

      const collected: any[] = []
      await buffer.drainUntil(null, ['t'], cmd => collected.push(cmd))
      expect(collected).to.deep.equal([])
    })

    it('7.11 a retried shard call re-delivering the same event id is deduplicated', async () => {
      const fake = new FakeSysApi()
      const buffer = new SharedSegmentBuffer()
      buffer.ensureLoading(fake as unknown as HyperClient, 'myapp', null)

      const call0 = fake.calls.get(Event.historyFetchTopic(0))!
      call0.progress({ events: [mkEvent('EVT_10', 0)], lastEventId: 'EVT_10' })
      call0.progress({ events: [mkEvent('EVT_10', 0)], lastEventId: 'EVT_10' })

      for (const [, call] of fake.calls) {
        call.resolve({ done: true })
      }

      const collected: string[] = []
      await buffer.drainUntil(null, ['t'], cmd => collected.push(cmd.qid))
      expect(collected).to.deep.equal(['EVT_10'])
    })
  })

  // ─── Integration: single-router entry + storage ────────────────────────────

  describe('single-router entry/storage integration', () => {
    let router: Router
    let dbFactory: DbFactory
    let db: sqlite.Database
    let netEngineMill: NetEngineMill
    let netRealm: BaseRealm
    let netApi: HyperClient
    let sysRealm: BaseRealm
    let storage: EventStorageTask

    beforeEach(async () => {
      db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      dbFactory = new DbFactory('/tmp/fox-test-dbs/')
      dbFactory.setMainDb(db)
      router = new Router()
      router.setId('E1')
      netEngineMill = new NetEngineMill(router, 1)
      netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
      router.initRealm('testnet', netRealm)
      netApi = netRealm.api()
      sysRealm = await router.getRealm('sys')
      storage = new EventStorageTask(sysRealm, dbFactory, { shards: [0] }, 'NDB1')
    })

    it('7.6 subscribe with after replays remaining committed history in order', async () => {
      const commitApi = sysRealm.buildApi()
      await commitSegment(commitApi, dbFactory, {
        shard: 0, realm: 'testnet', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [
          { uri: ['topicA'], data: { kv: 'd1' } },
          { uri: ['topicA'], data: { kv: 'd2' } },
          { uri: ['topicA'], data: { kv: 'd3' } }
        ]
      })

      const received: any[] = []
      await netApi.subscribe('topicA', (data: any) => {
        received.push(data)
      }, { after: 'seg1a1' })

      await new Promise(resolve => setTimeout(resolve, 20))
      expect(received).to.deep.equal(['d2', 'd3'])
    })

    it('7.7 two subscribers on the same realm share one fetch pass per shard', async () => {
      const commitApi = sysRealm.buildApi()
      await commitSegment(commitApi, dbFactory, {
        shard: 0, realm: 'testnet', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [{ uri: ['topicA'], data: { kv: 'd1' } }]
      })

      let callCount = 0
      const originalHandle = storage.handleHistoryFetch.bind(storage)
      ;(storage as any).handleHistoryFetch = (shard: number, req: any, opt: any) => {
        callCount++
        return originalHandle(shard, req, opt)
      }

      const netEngine = netRealm.getEngine() as NetEngine
      const rows1: any[] = []
      const rows2: any[] = []
      await Promise.all([
        netEngine.getHistoryAfter('', ['topicA'], (cmd: any) => rows1.push(cmd)),
        netEngine.getHistoryAfter('', ['topicA'], (cmd: any) => rows2.push(cmd))
      ])

      expect(callCount).to.equal(1)
    })
  })

  // ─── Shard replication: multiple registrants for the same shard ───────────

  describe('shard replication', () => {
    it('7.8 two storage nodes replicating shard 0 both register; a call is served by exactly one, no duplicate events', async () => {
      const db1 = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      const db2 = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      const dbFactory1 = new DbFactory('/tmp/fox-test-dbs/'); dbFactory1.setMainDb(db1)
      const dbFactory2 = new DbFactory('/tmp/fox-test-dbs/'); dbFactory2.setMainDb(db2)

      const router = new Router()
      router.setId('NDB_cluster')
      const sysRealm = await router.getRealm('sys')
      const api = sysRealm.buildApi()

      new EventStorageTask(sysRealm, dbFactory1, { shards: [0] }, 'A')
      new EventStorageTask(sysRealm, dbFactory2, { shards: [0] }, 'B')

      // Both registrants receive the same broadcast commit stream and independently
      // commit the same event to their own DB — this is how replication actually
      // happens in this architecture (fan-out pub/sub), not something the RPC layer does.
      await commitSegment(api, dbFactory1, {
        shard: 0, realm: 'myapp', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [{ uri: ['t'], data: { kv: 'd1' } }]
      })

      const progresses: HistoryFetchProgress[] = []
      const result = await api.callrpc(Event.historyFetchTopic(0), { realm: 'myapp', afterEventId: null }, {
        progress: (p: HistoryFetchProgress) => progresses.push(p)
      })

      expect(result).to.deep.equal({ done: true })
      const events = progresses.flatMap(p => p.events)
      expect(events.map(e => e.eventId)).to.deep.equal(['seg1a1'])
    })
  })

  // ─── Cross-router bridging ──────────────────────────────────────────────

  describe('genuinely separate storage and entry routers', () => {
    it('7.9 entry receives STORAGE_NODE_CONNECTED and can call the per-shard RPC bridged via listenEntry', async () => {
      const db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      const dbFactory = new DbFactory('/tmp/fox-test-dbs/')
      dbFactory.setMainDb(db)

      const storageRouter = new Router()
      storageRouter.setId('NDB1')
      const storageSysRealm = await storageRouter.getRealm('sys')
      const storage = new EventStorageTask(storageSysRealm, dbFactory, { shards: [0] }, 'NDB1')

      const entryRouter = new Router()
      entryRouter.setId('E1')
      const netEngineMill = new NetEngineMill(entryRouter, 1)
      const entrySysRealm = await entryRouter.getRealm('sys')

      const entryMemServer = new MemServer(new FoxGate(entryRouter))
      const clientIntoEntry = entryMemServer.createClient(entrySysRealm)

      await storage.listenEntry(clientIntoEntry, 'E1')
      await new Promise(resolve => setTimeout(resolve, 20))

      expect(netEngineMill.getNetSubStatusFactory().hasStorageNodes()).to.be.true

      const storageApi = storageSysRealm.buildApi()
      await commitSegment(storageApi, dbFactory, {
        shard: 0, realm: 'myapp', advanceOwner: 'e1', advanceStamp: 1, segment: 'seg1',
        events: [{ uri: ['t'], data: { kv: 'd1' } }]
      })

      const progresses: HistoryFetchProgress[] = []
      const result = await netEngineMill.getSysApi().callrpc(Event.historyFetchTopic(0), { realm: 'myapp', afterEventId: null }, {
        progress: (p: HistoryFetchProgress) => progresses.push(p)
      })

      expect(result).to.deep.equal({ done: true })
      expect(progresses.flatMap(p => p.events).map(e => e.eventId)).to.deep.equal(['seg1a1'])
    })
  })

  // ─── Regression: zero storage nodes connected anywhere ─────────────────────

  describe('zero storage nodes regression', () => {
    it('7.10 getHistoryAfter resolves (does not hang) when no shard RPCs are registered anywhere', async () => {
      const router = new Router()
      router.setId('E1')
      const netEngineMill = new NetEngineMill(router, 1)
      const netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
      router.initRealm('testnet', netRealm)

      const netEngine = netRealm.getEngine() as NetEngine
      const rows: any[] = []
      await netEngine.getHistoryAfter('', ['topicA'], (cmd: any) => rows.push(cmd))
      expect(rows).to.deep.equal([])
    })
  })

})
