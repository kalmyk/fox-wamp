import * as chai from 'chai'
const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus } from '../lib/types'
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

  it('creates realm-scoped kv_storages table with expected columns', async () => {
    await createStorageRegistryTables(db, 'realm1')

    const rows = await db.all(`PRAGMA table_info(kv_storages_realm1)`)
    const columns = rows.map((row: any) => row.name)

    expect(columns).to.include.members([
      'name',
      'uri_pattern',
      'storage_type',
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
      storageType: 'sqlite',
    })

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record).to.deep.equal({
      name: 'sqlite:realm1:app.topic.#',
      realmName: 'realm1',
      uriPattern: 'app.topic.#',
      storageType: 'sqlite',
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
      storageType: 'sqlite',
    })
    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Online)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg1a1')

    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      storageType: 'sqlite',
    })

    const record = await registry.get('sqlite:realm1:app.topic.#')

    expect(record!.status).to.equal(StorageStatus.Online)
    expect(record!.currentPosition).to.equal('seg1a1')
  })

  it('updates status position and last error', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      storageType: 'sqlite',
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

  it('resets registry metadata to inactive', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      storageType: 'sqlite',
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
