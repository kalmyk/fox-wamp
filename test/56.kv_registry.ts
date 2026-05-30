import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus } from '../lib/types'
import { createHistoryTables, saveEventHistory } from '../lib/sqlite/history'
import { createStorageRegistryTables, StorageRegistry } from '../lib/sqlite/storage_registry'

describe('56.kv_registry', function () {
  let db: sqlite.Database
  let registry: StorageRegistry

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database,
    })
    registry = new StorageRegistry(db, 'realm1')
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

  it('registers storage as inactive with dotted uri pattern', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record).to.deep.equal({
      name: 'sqlite:realm1:app.topic.#',
      realmName: 'realm1',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
      startedAt: null,
      status: StorageStatus.Inactive,
      currentPosition: null,
      lastError: null,
    })
  })

  it('keeps current position during idempotent registration', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })
    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Online)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg1a1')

    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic-v2',
    })

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record!.status).to.equal(StorageStatus.Online)
    expect(record!.currentPosition).to.equal('seg1a1')
  })

  it('updates status position and last error', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })

    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Refreshing, 1234)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg2')
    await registry.updateLastError('sqlite:realm1:app.topic.#', 'failed to apply')

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record!.status).to.equal(StorageStatus.Refreshing)
    expect(record!.startedAt).to.equal(1234)
    expect(record!.currentPosition).to.equal('seg2')
    expect(record!.lastError).to.equal('failed to apply')
  })

  it('starts activation by marking storage refreshing and capturing realm target', async () => {
    await createHistoryTables(db, 'realm1')
    await createHistoryTables(db, 'realm2')
    await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'topic'], 'a', {})
    await saveEventHistory(db, 'realm2', 'seg2a1', 0, ['app', 'topic'], 'b', {})
    await saveEventHistory(db, 'realm1', 'seg3a1', 0, ['app', 'topic'], 'c', {})
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })
    await registry.updateLastError('sqlite:realm1:app.topic.#', 'previous failure')

    const activation = await registry.startActivation('sqlite:realm1:app.topic.#', 1234)
    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(activation).to.deep.equal({
      name: 'sqlite:realm1:app.topic.#',
      status: StorageStatus.Refreshing,
      activationTarget: 'seg3a1',
      started: true,
    })
    expect(record!.status).to.equal(StorageStatus.Refreshing)
    expect(record!.startedAt).to.equal(1234)
    expect(record!.lastError).to.equal(null)
  })

  it('allows failed activation retry rejects duplicate activation and treats online activation as no-op', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })

    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Failed, 1234)
    await registry.updateLastError('sqlite:realm1:app.topic.#', 'previous failure')

    const retry = await registry.startActivation('sqlite:realm1:app.topic.#', 2345)
    expect(retry).to.deep.equal({
      name: 'sqlite:realm1:app.topic.#',
      status: StorageStatus.Refreshing,
      activationTarget: null,
      started: true,
    })

    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Refreshing, 1234)

    await expect(registry.startActivation('sqlite:realm1:app.topic.#', 5678))
      .to.be.rejectedWith('activation already running')

    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Online, 1234)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg1a1')

    const activation = await registry.startActivation('sqlite:realm1:app.topic.#', 5678)
    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(activation).to.deep.equal({
      name: 'sqlite:realm1:app.topic.#',
      status: StorageStatus.Online,
      activationTarget: 'seg1a1',
      started: false,
    })
    expect(record!.startedAt).to.equal(1234)
  })

  it('resets registry metadata to inactive', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })
    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Failed, 1234)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg2')
    await registry.updateLastError('sqlite:realm1:app.topic.#', 'failed to apply')

    await registry.reset('sqlite:realm1:app.topic.#')

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record!.status).to.equal(StorageStatus.Inactive)
    expect(record!.startedAt).to.equal(null)
    expect(record!.currentPosition).to.equal(null)
    expect(record!.lastError).to.equal(null)
  })
})
