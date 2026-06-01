import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { StorageStatus } from '../lib/types'
import { createHistoryTables, saveEventHistory } from '../lib/sqlite/history'
import { createStorageRegistryTables, StorageRegistry } from '../lib/sqlite/storage_registry'
import { ProduceId } from '../lib/masterfree/makeid'

describe('56.kv_registry', function () {
  let db: sqlite.Database
  let registry: StorageRegistry
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

    const history = await db.all(`SELECT * FROM update_history_realm1`)
    expect(history).to.have.lengthOf(1)
    expect(history[0].topic).to.equal('sqlite:realm1:app.topic.#')
    expect(history[0].old_updated_by_msg_id).to.be.null
    expect(history[0].msg_oldv).to.be.null
    expect(JSON.parse(history[0].msg_newv).status).to.equal(StorageStatus.Inactive)
  })

  it('keeps current position during idempotent registration and does not record duplicate history', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })
    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Online)
    await registry.updatePosition('sqlite:realm1:app.topic.#', 'seg1a1')

    const historyBefore = await db.all(`SELECT * FROM update_history_realm1`)

    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic-v2',
    })

    const record = await registry.get('sqlite:realm1:app.topic.#')
    expect(record!.status).to.equal(StorageStatus.Online)
    expect(record!.currentPosition).to.equal('seg1a1')

    const historyAfter = await db.all(`SELECT * FROM update_history_realm1`)
    expect(historyAfter).to.have.lengthOf(historyBefore.length)
  })

  it('updates status and records history', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })

    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Refreshing, 1234)
    
    const record = await registry.get('sqlite:realm1:app.topic.#')
    expect(record!.status).to.equal(StorageStatus.Refreshing)
    expect(record!.startedAt).to.equal(1234)

    const history = await db.all(`SELECT * FROM update_history_realm1 ORDER BY msg_id ASC`)
    expect(history).to.have.lengthOf(2) // register + status
    expect(JSON.parse(history[1].msg_oldv).status).to.equal(StorageStatus.Inactive)
    expect(JSON.parse(history[1].msg_newv).status).to.equal(StorageStatus.Refreshing)
  })

  it('starts activation and records history', async () => {
    await createHistoryTables(db, 'realm1')
    await saveEventHistory(db, 'realm1', 'seg1a1', 0, ['app', 'topic'], 'a', {})
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })

    await registry.startActivation('sqlite:realm1:app.topic.#', 1234)
    
    const history = await db.all(`SELECT * FROM update_history_realm1 ORDER BY msg_id ASC`)
    expect(history).to.have.lengthOf(2) // register + activate
    expect(JSON.parse(history[1].msg_oldv).status).to.equal(StorageStatus.Inactive)
    expect(JSON.parse(history[1].msg_newv).status).to.equal(StorageStatus.Refreshing)
  })

  it('resets registry metadata and records history', async () => {
    await registry.register({
      name: 'sqlite:realm1:app.topic.#',
      uriPattern: 'app.topic.#',
      schemaId: 'schema:app-topic',
    })
    await registry.updateStatus('sqlite:realm1:app.topic.#', StorageStatus.Failed, 1234)

    await registry.reset('sqlite:realm1:app.topic.#')

    const record = await registry.get('sqlite:realm1:app.topic.#')
    expect(record!.status).to.equal(StorageStatus.Inactive)

    const history = await db.all(`SELECT * FROM update_history_realm1 ORDER BY msg_id ASC`)
    expect(history).to.have.lengthOf(3) // register + status + reset
    expect(JSON.parse(history[2].msg_oldv).status).to.equal(StorageStatus.Failed)
    expect(JSON.parse(history[2].msg_newv).status).to.equal(StorageStatus.Inactive)
  })
})
