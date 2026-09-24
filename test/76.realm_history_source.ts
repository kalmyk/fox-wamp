import * as chai from 'chai'; const { expect } = chai

import { EventEmitter } from 'events'
import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus } from '../lib/types'
import { createHistoryTables, saveEventHistory } from '../lib/sqlite/history'
import { StorageRegistry } from '../lib/sqlite/storage_registry'
import { SchemaRepository, createSchemaTables } from '../lib/sqlite/schema_repository'
import { ProjectionListener } from '../lib/sqlite/projection_listener'
import { RealmHistorySource, RealmHistoryRow, LocalDbHistorySource } from '../lib/sqlite/realm_history_source'
import { WireHistoryFetchSource, WireRpcCaller } from '../lib/masterfree/wire_history_source'
import { WireSegmentCommittedSource, WireLink } from '../lib/masterfree/wire_segment_source'
import { SEGMENT_COMMITTED } from '../lib/masterfree/segment_types'
import { Event, HistoryEvent, HistoryFetchProgress, BODY_SEGMENT_COMMITTED } from '../lib/masterfree/hyper.h'
import { errorCodes, RealmError } from '../lib/realm_error'
import { HyperClient } from '../lib/hyper/client'

const makeId = {
  _count: 0,
  generateIdStr: function () { return 'test-id-' + (this._count++) }
} as any

function hist (eventId: string, shardTag: number, id: string, val: string): HistoryEvent {
  return { eventId, shardTag, uri: ['app', id, 'data'], data: { kv: { id, val } }, opt: { retain: true } }
}

// A caller whose per-shard responses are scripted: a shard maps to events to stream, an Error to
// reject with, or is absent to resolve with nothing.
class FakeCaller implements WireRpcCaller {
  calls: Array<{ uri: string, req: any }> = []
  constructor (private script: Map<number, HistoryEvent[] | Error>) {}

  async callrpc (uri: string, req: any, opt: any): Promise<any> {
    this.calls.push({ uri, req })
    const shard = Number(uri.split('.').pop())
    const response = this.script.get(shard)
    if (response instanceof Error) throw response
    if (response) {
      // stream in two batches, as the real per-shard RPC does
      const half = Math.ceil(response.length / 2)
      for (const batch of [response.slice(0, half), response.slice(half)]) {
        if (batch.length > 0) {
          const progress: HistoryFetchProgress = { events: batch, lastEventId: batch[batch.length - 1].eventId }
          opt.progress(progress)
        }
      }
    }
    return { done: true }
  }
}

async function collectRows (source: RealmHistorySource, realm: string, range: { fromId?: string, toId?: string } = {}): Promise<RealmHistoryRow[]> {
  const rows: RealmHistoryRow[] = []
  await source.fetchSince(realm, range, async (row) => { rows.push(row) })
  return rows
}

describe('76.realm_history_source', function () {
  describe('WireHistoryFetchSource', () => {
    it('3.3 merges per-shard results into ascending eventId order', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s2a1', 0, 'b', 'x'), hist('s5a1', 0, 'e', 'x')]],
        [1, [hist('s1a1', 1, 'a', 'x'), hist('s3a1', 1, 'c', 'x'), hist('s4a1', 1, 'd', 'x')]]
      ]))
      const source = new WireHistoryFetchSource(() => caller)

      const latest = await source.latestEventId('app')
      const rows = await collectRows(source, 'app')

      expect(latest).to.equal('s5a1')
      expect(rows.map(r => r.id)).to.deep.equal(['s1a1', 's2a1', 's3a1', 's4a1', 's5a1'])
    })

    it('3.3 asks every shard once, for the realm, and fetches only once for latestEventId + fetchSince', async () => {
      const caller = new FakeCaller(new Map())
      const source = new WireHistoryFetchSource(() => caller, 4)

      await source.latestEventId('app', 's1a1')
      await collectRows(source, 'app', { toId: 's9a1' })

      expect(caller.calls.map(c => c.uri)).to.deep.equal([0, 1, 2, 3].map(Event.historyFetchTopic))
      expect(caller.calls.every(c => c.req.realm === 'app' && c.req.afterEventId === 's1a1')).to.be.true
    })

    it('3.3 a shard with no owning storage node (ERROR_NO_SUCH_PROCEDURE) means nothing to fetch, not a failure', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s1a1', 0, 'a', 'x')]],
        [1, new RealmError('id', errorCodes.ERROR_NO_SUCH_PROCEDURE, 'no callee registered')]
      ]))
      const source = new WireHistoryFetchSource(() => caller, 2)

      expect(await source.latestEventId('app')).to.equal('s1a1')
    })

    it('3.3 recognizes the same condition when it arrives over a socket, as bare message text without a code', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s1a1', 0, 'a', 'x')]]
      ]))
      const original = caller.callrpc.bind(caller)
      caller.callrpc = async (uri: string, req: any, opt: any) => {
        if (uri === Event.historyFetchTopic(1)) {
          // what RemoteHyperClient rejects with: the wire error's data, a plain string
          throw 'no callee registered for procedure <fox.storage.history.fetch.1>' // eslint-disable-line no-throw-literal
        }
        return original(uri, req, opt)
      }
      const source = new WireHistoryFetchSource(() => caller, 2)

      expect(await source.latestEventId('app')).to.equal('s1a1')
    })

    it('3.3 any other shard failure fails the fetch instead of yielding a silently partial history', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s1a1', 0, 'a', 'x')]],
        [1, new Error('storage node exploded')]
      ]))
      const source = new WireHistoryFetchSource(() => caller, 2)

      let failure: Error | undefined
      try { await source.latestEventId('app') } catch (e) { failure = e as Error }
      expect(failure && failure.message).to.equal('storage node exploded')
    })

    it('3.3 fails clearly when no entry connection is available', async () => {
      const source = new WireHistoryFetchSource(() => undefined)
      let failure: Error | undefined
      try { await source.latestEventId('app') } catch (e) { failure = e as Error }
      expect(failure && failure.message).to.include('no entry connection')
    })

    it('3.3 honors fromId/toId as an exclusive/inclusive range', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s1a1', 0, 'a', 'x'), hist('s2a1', 0, 'b', 'x'), hist('s3a1', 0, 'c', 'x'), hist('s4a1', 0, 'd', 'x')]]
      ]))
      const source = new WireHistoryFetchSource(() => caller, 1)

      const rows = await collectRows(source, 'app', { fromId: 's1a1', toId: 's3a1' })
      expect(rows.map(r => r.id)).to.deep.equal(['s2a1', 's3a1'])
    })

    it('3.3 hands rows over in the stored (serializable) form applyEvent expects', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [{ eventId: 's1a1', shardTag: 0, uri: ['t'], data: { payload: Buffer.from('hello') }, opt: {} }]]
      ]))
      const source = new WireHistoryFetchSource(() => caller, 1)

      const rows = await collectRows(source, 'app')
      expect(rows[0].body).to.deep.equal({ p64: Buffer.from('hello').toString('base64') })
    })
  })

  describe('ProjectionListener with a pluggable history source', () => {
    const PROJ = 'proj1'
    const URL_PAT = 'app.*.data'
    const SCHEMA_DEF = { properties: { id: 'string', val: 'string' }, primary_key: ['id'] }

    let db: sqlite.Database
    let registry: StorageRegistry
    let schemas: SchemaRepository
    let dataTable: string

    beforeEach(async () => {
      db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      registry = new StorageRegistry(db, 'realm1', makeId)
      schemas = new SchemaRepository(db, 'realm1', makeId)
      await createSchemaTables(db, 'realm1')
      // a KV-node's DbEngine.launchEngine creates the realm's (empty) history tables
      await createHistoryTables(db, 'realm1')
      const schema = await schemas.register('label', URL_PAT, SCHEMA_DEF)
      dataTable = schema.dataTable
      await registry.register({ name: PROJ, uriPattern: URL_PAT, schemaId: schema.schemaId })
    })

    it('3.4 the default LocalDbHistorySource keeps today\'s behavior: nothing to backfill from an empty local history', async () => {
      const listener = new ProjectionListener(new EventEmitter(), db, makeId)
      await listener.activateProjection('realm1', PROJ)

      expect(await db.all(`SELECT * FROM "${dataTable}"`)).to.have.lengthOf(0)
      expect((await registry.get(PROJ))!.status).to.equal(StorageStatus.Online)
    })

    it('3.4 the default LocalDbHistorySource still replays history stored in the local db', async () => {
      await saveEventHistory(db, 'realm1', 's1a1', 0, ['app', 'x', 'data'], { kv: { id: 'x', val: 'local' } }, { retain: true })
      const listener = new ProjectionListener(new EventEmitter(), db, makeId, { historySource: new LocalDbHistorySource(db) })
      await listener.activateProjection('realm1', PROJ)

      expect(await db.all(`SELECT id, val FROM "${dataTable}"`)).to.deep.equal([{ id: 'x', val: 'local' }])
    })

    it('3.4 first activation of a realm with pre-existing remote history backfills it before going online', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s2a1', 0, 'b', 'two'), hist('s4a1', 0, 'd', 'four')]],
        [1, [hist('s1a1', 1, 'a', 'one'), hist('s3a1', 1, 'c', 'three')]]
      ]))
      const listener = new ProjectionListener(new EventEmitter(), db, makeId, {
        historySource: new WireHistoryFetchSource(() => caller, 2)
      })

      await listener.activateProjection('realm1', PROJ)

      const rows = await db.all(`SELECT id, val FROM "${dataTable}" ORDER BY id`)
      expect(rows).to.deep.equal([
        { id: 'a', val: 'one' }, { id: 'b', val: 'two' }, { id: 'c', val: 'three' }, { id: 'd', val: 'four' }
      ])
      const record = (await registry.get(PROJ))!
      expect(record.status).to.equal(StorageStatus.Online)
      expect(record.currentPosition).to.equal('s4a1')
    })

    it('3.4 a failing shard rejects the activation before anything is applied, never leaving the projection online with partial data', async () => {
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s1a1', 0, 'a', 'one')]],
        [1, new Error('storage node exploded')]
      ]))
      const listener = new ProjectionListener(new EventEmitter(), db, makeId, {
        historySource: new WireHistoryFetchSource(() => caller, 2)
      })

      let failure: Error | undefined
      try { await listener.activateProjection('realm1', PROJ) } catch (e) { failure = e as Error }

      expect(failure && failure.message).to.equal('storage node exploded')
      // the wire source fetches the whole snapshot while resolving the activation target, i.e.
      // before the projection leaves 'inactive': the admin caller sees the error, retries later,
      // and nothing was half-applied
      expect((await registry.get(PROJ))!.status).to.equal(StorageStatus.Inactive)
      expect(await db.all(`SELECT * FROM "${dataTable}"`)).to.have.lengthOf(0)
    })

    it('3.5 a SEGMENT_COMMITTED delivered mid-catch-up is not applied while the projection is refreshing', async () => {
      // a source whose catch-up we can hold open
      let release!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const slowSource: RealmHistorySource = {
        latestEventId: async () => 's1a1',
        fetchSince: async (_realm, _range, cb) => {
          await gate
          await cb({ id: 's1a1', shard: 0, uri: ['app', 'a', 'data'], body: { kv: { id: 'a', val: 'caught-up' } }, opt: { retain: true } })
        }
      }
      const emitter = new EventEmitter()
      const listener = new ProjectionListener(emitter, db, makeId, { historySource: slowSource })

      const activation = listener.activateProjection('realm1', PROJ)
      await new Promise(resolve => setTimeout(resolve, 20))
      expect((await registry.get(PROJ))!.status).to.equal(StorageStatus.Refreshing)

      await listener.handleSegmentCommitted({
        origin: 'NDB1', advanceOwner: 'e1', advanceStamp: 1, segment: 's2',
        events: [{ eventId: 's2a1', realm: 'realm1', uri: ['app', 'live', 'data'], data: { kv: { id: 'live', val: 'mid' } }, opt: { retain: true }, sid: 's', shard: 0 }]
      })
      expect(await db.all(`SELECT * FROM "${dataTable}"`)).to.have.lengthOf(0) // still refreshing: not applied

      release()
      await activation
      expect((await registry.get(PROJ))!.status).to.equal(StorageStatus.Online)
      expect(await db.all(`SELECT id, val FROM "${dataTable}"`)).to.deep.equal([{ id: 'a', val: 'caught-up' }])
    })
  })

  describe('catch-up seeds the live ordering guard', () => {
    class Link implements WireLink {
      readonly name = 'E1'
      private handlers: Array<(body: BODY_SEGMENT_COMMITTED) => void> = []
      isConnected (): boolean { return true }
      onSegmentCommitted (h: (body: BODY_SEGMENT_COMMITTED) => void): void { this.handlers.push(h) }
      onStateChange (): void {}
      getClient (): HyperClient | undefined { return undefined }
      deliver (body: BODY_SEGMENT_COMMITTED): void { for (const h of this.handlers) h(body) }
    }

    it('2.5a a live record older than what catch-up applied cannot regress the projection after it goes online', async () => {
      const db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      const registry = new StorageRegistry(db, 'realm1', makeId)
      const schemas = new SchemaRepository(db, 'realm1', makeId)
      await createSchemaTables(db, 'realm1')
      await createHistoryTables(db, 'realm1')
      const schema = await schemas.register('label', 'app.*.data', { properties: { id: 'string', val: 'string' }, primary_key: ['id'] })
      await registry.register({ name: 'proj1', uriPattern: 'app.*.data', schemaId: schema.schemaId })

      const link = new Link()
      const wire = new WireSegmentCommittedSource([link], () => {})
      const caller = new FakeCaller(new Map<number, HistoryEvent[] | Error>([
        [0, [hist('s9a1', 0, 'z', 'caught-up')]]
      ]))
      const listener = new ProjectionListener(wire, db, makeId, {
        historySource: new WireHistoryFetchSource(() => caller, 1),
        onProjectionOnline: (realm, position) => wire.seedHighWater(realm, position)
      })

      await listener.activateProjection('realm1', 'proj1')
      expect((await registry.get('proj1'))!.currentPosition).to.equal('s9a1')

      const live = (eventId: string, id: string, val: string): BODY_SEGMENT_COMMITTED => ({
        origin: 'NDB1', advanceOwner: 'e1', advanceStamp: 1, segment: eventId.slice(0, 2),
        events: [{ eventId, realm: 'realm1', uri: ['app', id, 'data'], data: { kv: { id, val } }, opt: { retain: true }, sid: 's', shard: 0 }]
      })
      link.deliver(live('s5a1', 'old', 'stale')) // committed before catch-up's snapshot: must be dropped
      link.deliver(live('s9a2', 'new', 'fresh'))
      await new Promise(resolve => setTimeout(resolve, 50))

      expect(await db.all(`SELECT id, val FROM "${schema.dataTable}" ORDER BY id`)).to.deep.equal([
        { id: 'new', val: 'fresh' }, { id: 'z', val: 'caught-up' }
      ])
      expect((await registry.get('proj1'))!.currentPosition).to.equal('s9a2')
      // and the wire source really was the ProjectionListener's feed
      expect(wire).to.have.property('on')
      void SEGMENT_COMMITTED
    })
  })
})
