import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus } from '../lib/types'
import { createHistoryTables, saveEventHistory } from '../lib/sqlite/history'
import { createStorageRegistryTables, StorageRegistry } from '../lib/sqlite/storage_registry'
import { createSchemaTables, SchemaRepository } from '../lib/sqlite/schema_repository'
import { ProduceId } from '../lib/masterfree/makeid'

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
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })

    const record = await registry.get('sqlite:realm1:app.{a}.data')

    expect(record).to.deep.equal({
      name: 'sqlite:realm1:app.{a}.data',
      realmName: 'realm1',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
      startedAt: null,
      status: StorageStatus.Inactive,
      currentPosition: null,
      lastError: null,
    })

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema registration + storage registration
    expect(history).to.have.lengthOf(2)
    const storageHistory = history.find(h => h.topic === 'sqlite:realm1:app.{a}.data')
    expect(storageHistory).to.exist
    expect(JSON.parse(storageHistory.msg_newv).status).to.equal(StorageStatus.Inactive)
  })

  it('fails if schema does not exist', async () => {
    await expect(registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: 'missing',
    })).to.be.rejectedWith('Schema not found: missing')
  })

  it('fails if uriPattern does not match schema urlPattern', async () => {
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await expect(registry.register({
      name: 'sqlite:realm1:other.topic.#',
      uriPattern: 'other.topic.#',
      schemaId: schema.schemaId,
    })).to.be.rejectedWith('Storage uriPattern "other.topic.#" does not match schema urlPattern "app.{a}.data"')
  })

  it('keeps current position during idempotent registration and does not record duplicate history', async () => {
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })

    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })
    await registry.updateStatus('sqlite:realm1:app.{a}.data', StorageStatus.Online)
    await registry.updatePosition('sqlite:realm1:app.{a}.data', 'seg1a1')

    const historyBefore = await db.all(`SELECT * FROM update_history_realm1`)

    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })

    const record = await registry.get('sqlite:realm1:app.{a}.data')
    expect(record!.status).to.equal(StorageStatus.Online)
    expect(record!.currentPosition).to.equal('seg1a1')

    const historyAfter = await db.all(`SELECT * FROM update_history_realm1`)
    expect(historyAfter).to.have.lengthOf(historyBefore.length)
  })

  it('updates status and records history', async () => {
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })

    await registry.updateStatus('sqlite:realm1:app.{a}.data', StorageStatus.Refreshing, 1234)
    
    const record = await registry.get('sqlite:realm1:app.{a}.data')
    expect(record!.status).to.equal(StorageStatus.Refreshing)
    expect(record!.startedAt).to.equal(1234)

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + status
    expect(history).to.have.lengthOf(3)
    const statusHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.{a}.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Inactive && newV?.status === StorageStatus.Refreshing
    })
    expect(statusHistory).to.exist
  })

  it('starts activation and records history', async () => {
    await createHistoryTables(db, 'realm1')
    await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'topic'], 'a', {})
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })

    await registry.startActivation('sqlite:realm1:app.{a}.data', 1234)
    
    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + activate
    expect(history).to.have.lengthOf(3)
    const activationHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.{a}.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Inactive && newV?.status === StorageStatus.Refreshing
    })
    expect(activationHistory).to.exist
  })

  it('resets registry metadata and records history', async () => {
    const schema = await schemas.register('label', 'app.{a}.data', { properties: { a: 'string' }, primary_key: ['a'] })
    await registry.register({
      name: 'sqlite:realm1:app.{a}.data',
      uriPattern: 'app.{a}.data',
      schemaId: schema.schemaId,
    })
    await registry.updateStatus('sqlite:realm1:app.{a}.data', StorageStatus.Failed, 1234)

    await registry.reset('sqlite:realm1:app.{a}.data')

    const record = await registry.get('sqlite:realm1:app.{a}.data')
    expect(record!.status).to.equal(StorageStatus.Inactive)

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    // schema + register + status + reset
    expect(history).to.have.lengthOf(4)
    const resetHistory = history.find(h => {
      if (h.topic !== 'sqlite:realm1:app.{a}.data') return false
      const oldV = h.msg_oldv ? JSON.parse(h.msg_oldv) : null
      const newV = h.msg_newv ? JSON.parse(h.msg_newv) : null
      return oldV?.status === StorageStatus.Failed && newV?.status === StorageStatus.Inactive
    })
    expect(resetHistory).to.exist
  })
})
