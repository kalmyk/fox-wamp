import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import { EventEmitter } from 'events'
import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus, SchemaRecord } from '../lib/types'
import { createHistoryTables, saveEventHistory } from '../lib/sqlite/history'
import { createStorageRegistryTables, StorageRegistry } from '../lib/sqlite/storage_registry'
import { createSchemaTables, SchemaRepository } from '../lib/sqlite/schema_repository'
import { ProjectionListener } from '../lib/sqlite/projection_listener'
import { CommittedSegmentEvent } from '../lib/masterfree/storage'
import { ProduceId, keyId } from '../lib/masterfree/makeid'

describe('56.kv_registry', function () {
  let db: sqlite.Database
  let registry: StorageRegistry
  let schemas: SchemaRepository
  const makeId = {
    _count: 0,
    generateIdStr: function() { return 'test-id-' + (this._count++) }
  } as any

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database,
    })
    registry = new StorageRegistry(db, 'realm1', makeId)
    schemas = new SchemaRepository(db, 'realm1', makeId)
    await createSchemaTables(db, 'realm1')
  })

  it('creates realm-scoped kv_storage table with expected columns', async () => {
    await createStorageRegistryTables(db, 'realm1')

    const rows = await db.all(`PRAGMA table_info(kv_storage_realm1)`)
    const columns = rows.map((row: any) => row.name)

    expect(columns).to.include.members([
      'name',
      'schema_id',
      'uri_pattern',
      'started_at',
      'status',
      'current_position',
      'last_error',
    ])
  })

  it('registers storage as inactive and records history', async () => {
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })

    const record = await registry.get('sqlite:realm1:app.*.data')

    expect(record).to.deep.equal({
      name: 'sqlite:realm1:app.*.data',
      realmName: 'realm1',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
      startedAt: null,
      status: StorageStatus.Inactive,
      currentPosition: null,
      lastError: null,
    })

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema registration + storage registration
    expect(history).to.have.lengthOf(2)
    const storageHistory = history.find(h => h.topic === 'sqlite:realm1:app.*.data')
    expect(storageHistory).to.exist
    expect(JSON.parse(storageHistory.msg_newv).status).to.equal(StorageStatus.Inactive)
  })

  it('fails if schema does not exist', async () => {
    await expect(registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: 'missing',
    })).to.be.rejectedWith('Schema not found: missing')
  })

  it('fails if uriPattern does not match schema urlPattern', async () => {
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await expect(registry.register({
      name: 'sqlite:realm1:other.topic.#',
      uriPattern: 'other.topic.#',
      schemaId: schema.schemaId,
    })).to.be.rejectedWith('Storage uriPattern "other.topic.#" does not match schema urlPattern "app.*.data"')
  })

  it('keeps current position during idempotent registration and does not record duplicate history', async () => {
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })
    await registry.updateStatus('sqlite:realm1:app.*.data', StorageStatus.Online)
    await registry.updatePosition('sqlite:realm1:app.*.data', 'seg1a1')

    const historyBefore = await db.all(`SELECT * FROM update_history_realm1`)

    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })

    const record = await registry.get('sqlite:realm1:app.*.data')
    expect(record!.status).to.equal(StorageStatus.Online)
    expect(record!.currentPosition).to.equal('seg1a1')

    const historyAfter = await db.all(`SELECT * FROM update_history_realm1`)
    expect(historyAfter).to.have.lengthOf(historyBefore.length)
  })

  it('updates status and records history', async () => {
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })

    await registry.updateStatus('sqlite:realm1:app.*.data', StorageStatus.Refreshing, 1234)
    
    const record = await registry.get('sqlite:realm1:app.*.data')
    expect(record!.status).to.equal(StorageStatus.Refreshing)
    expect(record!.startedAt).to.equal(1234)

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + status
    expect(history).to.have.lengthOf(3)
    const statusHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.*.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Inactive && newV?.status === StorageStatus.Refreshing
    })
    expect(statusHistory).to.exist
  })

  it('starts activation and records history', async () => {
    await createHistoryTables(db, 'realm1')
    await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'topic'], 'a', {})
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })

    await registry.startActivation('sqlite:realm1:app.*.data', 1234)
    
    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + activate
    expect(history).to.have.lengthOf(3)
    const activationHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.*.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Inactive && newV?.status === StorageStatus.Refreshing
    })
    expect(activationHistory).to.exist
  })

  it('resets registry metadata and records history', async () => {
    const schema = await schemas.register('label', 'app.*.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.*.data',
      uriPattern: 'app.*.data',
      schemaId: schema.schemaId,
    })
    await registry.updateStatus('sqlite:realm1:app.*.data', StorageStatus.Failed, 1234)

    await registry.reset('sqlite:realm1:app.*.data')

    const record = await registry.get('sqlite:realm1:app.*.data')
    expect(record!.status).to.equal(StorageStatus.Inactive)

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + status + reset
    expect(history).to.have.lengthOf(4)
    const resetHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.*.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Failed && newV?.status === StorageStatus.Inactive
    })
    expect(resetHistory).to.exist
  })

  describe('ProjectionListener', function () {
    const PROJ = 'proj1'
    const URL_PAT = 'app.*.data'
    const SCHEMA_DEF = { properties: { id: 'string', val: 'string' }, primary_key: ['id'] }

    let storageEmitter: EventEmitter
    let listener: ProjectionListener
    let schemaRec: SchemaRecord

    function makeSeg(segId: string, events: any[]): CommittedSegmentEvent {
      return { advanceOwner: 'entry1', advanceStamp: 1, segment: segId, events }
    }
    function makeEvt(eventId: string, realm: string, uri: string[], data: any, retain = true) {
      return { eventId, realm, uri, data, opt: { retain }, sid: 's1', shard: 0 }
    }

    beforeEach(async () => {
      await createHistoryTables(db, 'realm1')
      storageEmitter = new EventEmitter()
      listener = new ProjectionListener(storageEmitter as any, db, makeId)
      schemaRec = await schemas.register('label', URL_PAT, SCHEMA_DEF)
      await registry.register({ name: PROJ, uriPattern: URL_PAT, schemaId: schemaRec.schemaId })
    })

    it('5.4 retained KV state updated only after SEGMENT_COMMITTED, not on saveEventHistory', async () => {
      await listener.activateProjection('realm1', PROJ)

      // Save retained event directly to history (simulates pre-commit state)
      await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } }, { retain: true })

      // Projection data table still empty — history save alone does not trigger projection
      const before = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(before).to.have.lengthOf(0)

      // SEGMENT_COMMITTED now drives the projection update
      await listener.handleSegmentCommitted(makeSeg('seg1', [
        makeEvt('seg1a1', 'realm1', ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } })
      ]))

      const after = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(after).to.have.lengthOf(1)
    })

    it('5.5 non-retained events do not change KV state but segment advances current_position', async () => {
      await listener.activateProjection('realm1', PROJ)

      await listener.handleSegmentCommitted(makeSeg('seg1', [
        makeEvt('seg1a1', 'realm1', ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } }, false)
      ]))

      // KV data unchanged
      const rows = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows).to.have.lengthOf(0)

      // current_position advanced to segment watermark
      const rec = await registry.get(PROJ)
      expect(rec!.currentPosition).to.equal('seg1')
    })

    it('5.7 activation moves through refreshing to online after historical catch-up', async () => {
      await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } }, { retain: true })

      const before = await registry.get(PROJ)
      expect(before!.status).to.equal(StorageStatus.Inactive)

      await listener.activateProjection('realm1', PROJ)

      const after = await registry.get(PROJ)
      expect(after!.status).to.equal(StorageStatus.Online)
      expect(after!.currentPosition).to.equal('seg1a1')

      const rows = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows).to.have.lengthOf(1)
      expect(rows[0].id).to.equal('1')
    })

    it('5.8 activation failure sets failed status and records last_error', async () => {
      // Retained event missing primary key 'id' — fails schema validation
      await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'x', 'data'], { kv: { val: 'v' } }, { retain: true })

      await expect(listener.activateProjection('realm1', PROJ)).to.be.rejected

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Failed)
      expect(rec!.lastError).to.be.a('string')
      expect(rec!.lastError).to.include('id')
    })

    it('5.9 activation target is realm-scoped latest event ID, not cross-realm', async () => {
      await createHistoryTables(db, 'realm2')
      // realm2 has a lower event ID than realm1's event
      await saveEventHistory(db, 'realm2', 'aaa_seg', 0, ['other', 'topic'], { kv: { id: 'x' } }, { retain: true })
      // realm1 has a higher event ID
      await saveEventHistory(db, 'realm1', 'zzz_seg', 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } }, { retain: true })

      await listener.activateProjection('realm1', PROJ)

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Online)
      // If activation wrongly used realm2's lower 'aaa_seg' as target, realm1's
      // 'zzz_seg' event would be beyond the target and would not be applied.
      expect(rec!.currentPosition).to.equal('zzz_seg')
      const rows = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows).to.have.lengthOf(1)
    })

    it('5.11 activation catch-up applies events in string ID order up to activation target', async () => {
      const id1 = 'seg1' + keyId(1)
      const id2 = 'seg1' + keyId(2)

      await saveEventHistory(db, 'realm1', id1, 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'first' } }, { retain: true })
      await saveEventHistory(db, 'realm1', id2, 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'second' } }, { retain: true })

      await listener.activateProjection('realm1', PROJ)

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Online)
      expect(rec!.currentPosition).to.equal(id2)

      // Both events applied in order; second write wins for same PK
      const rows = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows).to.have.lengthOf(1)
      expect(rows[0].val).to.equal('second')
    })

    it('5.12 reset clears projected KV data, current_position, last_error → inactive', async () => {
      await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } }, { retain: true })
      await listener.activateProjection('realm1', PROJ)

      const rowsBefore = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rowsBefore).to.have.lengthOf(1)

      await listener.resetProjection('realm1', PROJ)

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Inactive)
      expect(rec!.currentPosition).to.be.null
      expect(rec!.lastError).to.be.null

      const rowsAfter = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rowsAfter).to.have.lengthOf(0)
    })

    it('5.14 empty-realm activation sets online with current_position NULL', async () => {
      // No history events — realm has no committed events
      await listener.activateProjection('realm1', PROJ)

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Online)
      expect(rec!.currentPosition).to.be.null
    })

    it('5.15 SEGMENT_COMMITTED advances current_position for all online projections', async () => {
      const schema2 = await schemas.register('lbl2', 'other.*.msg', { properties: { id: 'string' }, primary_key: ['id'] })
      await registry.register({ name: 'proj2', uriPattern: 'other.*.msg', schemaId: schema2.schemaId })

      await listener.activateProjection('realm1', PROJ)
      await listener.activateProjection('realm1', 'proj2')

      // Event matches only proj1's pattern, not proj2's
      await listener.handleSegmentCommitted(makeSeg('seg1', [
        makeEvt('seg1a1', 'realm1', ['app', 'x', 'data'], { kv: { id: '1', val: 'v' } })
      ]))

      const rec1 = await registry.get(PROJ)
      expect(rec1!.currentPosition).to.equal('seg1a1')

      // proj2 had no matching event but still advances to segment watermark
      const rec2 = await registry.get('proj2')
      expect(rec2!.currentPosition).to.equal('seg1')
    })

    it('5.16 committed segment ID compares greater than all previous event IDs by string', () => {
      const prevSeg = 'seg1'
      const prevEvt1 = prevSeg + keyId(1)
      const prevEvt9 = prevSeg + keyId(9)
      const nextSeg = 'seg2'

      expect(nextSeg > prevEvt1).to.be.true
      expect(nextSeg > prevEvt9).to.be.true
      expect(nextSeg > prevSeg).to.be.true
    })

    it('5.17 retained event stored in all matching projections and none in non-matching', async () => {
      // Second projection with same url_pattern but different schema (different dataTable)
      const schema17 = await schemas.register('lbl17', URL_PAT, { properties: { id: 'string', note: 'string' }, primary_key: ['id'] })
      await registry.register({ name: 'proj17', uriPattern: URL_PAT, schemaId: schema17.schemaId })

      // Non-matching projection
      const schemaNon = await schemas.register('lbl-non', 'other.*.msg', { properties: { id: 'string' }, primary_key: ['id'] })
      await registry.register({ name: 'proj-non', uriPattern: 'other.*.msg', schemaId: schemaNon.schemaId })

      await listener.activateProjection('realm1', PROJ)
      await listener.activateProjection('realm1', 'proj17')
      await listener.activateProjection('realm1', 'proj-non')

      await listener.handleSegmentCommitted(makeSeg('seg1', [
        makeEvt('seg1a1', 'realm1', ['app', 'x', 'data'], { kv: { id: '1', val: 'hello', note: 'world' } })
      ]))

      // Both matching projections received the event
      const rows1 = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows1).to.have.lengthOf(1)
      expect(rows1[0].id).to.equal('1')

      const rows17 = await db.all(`SELECT * FROM "${schema17.dataTable}"`)
      expect(rows17).to.have.lengthOf(1)
      expect(rows17[0].id).to.equal('1')

      // Non-matching projection has no data
      const rowsNon = await db.all(`SELECT * FROM "${schemaNon.dataTable}"`)
      expect(rowsNon).to.have.lengthOf(0)
    })

    it('5.18 schema validation runs before projected value is stored', async () => {
      await listener.activateProjection('realm1', PROJ)

      // id is declared as 'string' in schema but sent as number → type validation fails
      await listener.handleSegmentCommitted(makeSeg('seg1', [
        makeEvt('seg1a1', 'realm1', ['app', 'x', 'data'], { kv: { id: 123, val: 'hello' } })
      ]))

      const rec = await registry.get(PROJ)
      expect(rec!.status).to.equal(StorageStatus.Failed)

      // No data stored due to validation failure
      const rows = await db.all(`SELECT * FROM "${schemaRec.dataTable}"`)
      expect(rows).to.have.lengthOf(0)
    })

    it('5.19 null from MQTT empty retained payload deletes the projected row', async () => {
      // Schema with key_from_uri so PK can be extracted from URI when payload is null
      const schema19 = await schemas.register('del-test', URL_PAT, {
        properties: { id: 'string', val: 'string' },
        primary_key: ['id'],
        key_from_uri: { id: 1 },
      })
      const PROJ19 = 'proj19'
      await registry.register({ name: PROJ19, uriPattern: URL_PAT, schemaId: schema19.schemaId })

      // Activate with one pre-existing retained row
      await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'myid', 'data'], { kv: { id: 'myid', val: 'hello' } }, { retain: true })
      await listener.activateProjection('realm1', PROJ19)

      const rowsBefore = await db.all(`SELECT * FROM "${schema19.dataTable}"`)
      expect(rowsBefore).to.have.lengthOf(1)

      // MQTT empty payload → null data; URI encodes the primary key for deletion
      await listener.handleSegmentCommitted(makeSeg('seg2', [
        makeEvt('seg2a1', 'realm1', ['app', 'myid', 'data'], null)
      ]))

      const rowsAfter = await db.all(`SELECT * FROM "${schema19.dataTable}"`)
      expect(rowsAfter).to.have.lengthOf(0)
    })
  })
})
