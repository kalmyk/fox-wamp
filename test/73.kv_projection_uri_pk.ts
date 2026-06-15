import * as chai from 'chai'; const { expect } = chai;
import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { KvProjection } from '../lib/sqlite/projection_listener'
import { StorageStatus, StorageRecord } from '../lib/types'

describe('73.kv_projection_uri_pk', function () {
  let db: sqlite.Database
  const realmName = 'testrealm'
  const dataTable = 'data_test_table'

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    
    // Create data table
    await db.run(`CREATE TABLE "${dataTable}" (
      "user_id" TEXT PRIMARY KEY,
      "username" TEXT,
      "email" TEXT
    )`)

    // Create registry table for advancePosition/setStatus to work if needed
    await db.run(`CREATE TABLE kv_storage_${realmName} (
      name TEXT PRIMARY KEY,
      schema_id TEXT,
      uri_pattern TEXT,
      started_at INTEGER,
      status TEXT,
      current_position TEXT,
      last_error TEXT
    )`)
  })

  it('deletes row using URI-derived primary key when payload is empty', async () => {
    const schemaJson = {
      properties: {
        user_id: 'string',
        username: 'string',
        email: 'string'
      },
      primary_key: ['user_id'],
      key_from_uri: {
        user_id: 2
      }
    }

    const record: StorageRecord = {
      name: 'test-proj',
      realmName,
      uriPattern: 'app.user.#',
      schemaId: 'sch1',
      status: StorageStatus.Online,
      currentPosition: null,
      lastError: null,
      startedAt: Date.now()
    }

    // Insert initial data
    await db.run(`INSERT INTO "${dataTable}" (user_id, username, email) VALUES (?, ?, ?)`, ['123', 'jdoe', 'j@example.com'])

    const projection = new KvProjection(db, record, schemaJson, dataTable)

    // Apply a delete event (retained-clean, payload is null/empty)
    await projection.applyEvent({
      eventId: 'evt1',
      realm: realmName,
      uri: ['app', 'user', '123'], // Index 2 is '123'
      data: { args: [null] }, // Empty payload in WAMP style [null] results in payload=null
      opt: { retain: true },
      sid: '',
      shard: 1
    })

    const row = await db.get(`SELECT * FROM "${dataTable}" WHERE user_id = ?`, ['123'])
    expect(row).to.be.undefined
  })

  it('updates row using body keys, ignoring URI if body has them', async () => {
     const schemaJson = {
      properties: {
        user_id: 'string',
        username: 'string'
      },
      primary_key: ['user_id'],
      key_from_uri: {
        user_id: 2
      }
    }

    const record: StorageRecord = {
      name: 'test-proj',
      realmName,
      uriPattern: 'app.user.#',
      schemaId: 'sch1',
      status: StorageStatus.Online,
      currentPosition: null,
      lastError: null,
      startedAt: Date.now()
    }

    const projection = new KvProjection(db, record, schemaJson, dataTable)

    // Apply an update event where body HAS the key
    await projection.applyEvent({
      eventId: 'evt2',
      realm: realmName,
      uri: ['app', 'user', 'wrong-id'], // Index 2 is 'wrong-id'
      data: { args: [{ user_id: '123', username: 'jdoe' }] }, 
      opt: { retain: true },
      sid: '',
      shard: 1
    })

    const row = await db.get(`SELECT * FROM "${dataTable}" WHERE user_id = ?`, ['123'])
    expect(row).to.exist
    expect(row.username).to.equal('jdoe')
    
    const wrongRow = await db.get(`SELECT * FROM "${dataTable}" WHERE user_id = ?`, ['wrong-id'])
    expect(wrongRow).to.be.undefined
  })
})
