import * as sqlite from 'sqlite'

import { StorageRecord, StorageStatus } from '../types'
import { ProduceId } from '../masterfree/makeid'
import { createUpdateHistoryTable, saveUpdateHistory } from './update_history'

export type StorageRegistration = {
  name: string
  uriPattern: string
  schemaId: string
}

export type StorageActivation = {
  name: string
  status: StorageStatus
  activationTarget: string | null
  started: boolean
}

function storageRegistryTableName(realmName: string): string {
  return `kv_storage_${realmName}`
}

function mapStorageRecord(realmName: string, row: any): StorageRecord {
  return {
    name: row.name,
    realmName,
    uriPattern: row.uri_pattern,
    schemaId: row.schema_id,
    startedAt: row.started_at === null || row.started_at === undefined ? null : row.started_at,
    status: row.status,
    currentPosition: row.current_position === undefined ? null : row.current_position,
    lastError: row.last_error === undefined ? null : row.last_error,
  }
}

async function latestRealmEventId(db: sqlite.Database, realmName: string): Promise<string | null> {
  const tableName = `event_history_${realmName}`
  const table = await db.get(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
    [tableName]
  )
  if (!table) {
    return null
  }
  const row = await db.get(
    `SELECT MAX(msg_id) max_id FROM ${tableName}`,
    []
  )
  return row && row.max_id ? row.max_id : null
}

export async function createStorageRegistryTables(db: sqlite.Database, realmName: string): Promise<void> {
  await createUpdateHistoryTable(db, realmName)
  await db.run(
    `CREATE TABLE IF NOT EXISTS ${storageRegistryTableName(realmName)} (
      name TEXT PRIMARY KEY,
      schema_id TEXT NOT NULL,
      uri_pattern TEXT NOT NULL,
      started_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('inactive', 'refreshing', 'online', 'failed')) DEFAULT 'inactive',
      current_position TEXT,
      last_error TEXT,
      FOREIGN KEY(schema_id) REFERENCES message_schemas_${realmName}(schema_id)
    );`
  )
}

export class StorageRegistry {
  private db: sqlite.Database
  private realmName: string
  private tableName: string
  private makeId: ProduceId

  constructor(db: sqlite.Database, realmName: string, makeId: ProduceId) {
    this.db = db
    this.realmName = realmName
    this.tableName = storageRegistryTableName(realmName)
    this.makeId = makeId
  }

  async init(): Promise<void> {
    await createStorageRegistryTables(this.db, this.realmName)
  }

  async register(storage: StorageRegistration): Promise<void> {
    await this.init()
    const oldRecord = await this.get(storage.name)
    if (oldRecord) return

    // Verify schema existence and pattern compatibility
    const schemaRow = await this.db.get(
      `SELECT url_pattern FROM message_schemas_${this.realmName} WHERE schema_id = ?`,
      [storage.schemaId]
    )
    if (!schemaRow) {
      throw new Error(`Schema not found: ${storage.schemaId}`)
    }
    if (schemaRow.url_pattern !== storage.uriPattern) {
      throw new Error(`Storage uriPattern "${storage.uriPattern}" does not match schema urlPattern "${schemaRow.url_pattern}"`)
    }

    await this.db.run(
      `INSERT OR IGNORE INTO ${this.tableName}
        (name, schema_id, uri_pattern, started_at, status, current_position, last_error)
        VALUES (?, ?, ?, NULL, ?, NULL, NULL)`,
      [
        storage.name,
        storage.schemaId,
        storage.uriPattern,
        StorageStatus.Inactive,
      ]
    )
    const newRecord = await this.get(storage.name)
    await saveUpdateHistory(
      this.db,
      this.realmName,
      this.makeId.generateIdStr(),
      null,
      storage.name,
      null,
      newRecord
    )
  }

  async get(name: string): Promise<StorageRecord | null> {
    await this.init()
    const row = await this.db.get(
      `SELECT name, schema_id, uri_pattern, started_at, status, current_position, last_error
        FROM ${this.tableName}
        WHERE name = ?`,
      [name]
    )
    return row ? mapStorageRecord(this.realmName, row) : null
  }

  async list(): Promise<StorageRecord[]> {
    await this.init()
    const rows = await this.db.all(
      `SELECT name, schema_id, uri_pattern, started_at, status, current_position, last_error
        FROM ${this.tableName}
        ORDER BY name`,
      []
    )
    return rows.map(row => mapStorageRecord(this.realmName, row))
  }

  async updateStatus(name: string, status: StorageStatus, startedAt?: number | null): Promise<void> {
    await this.init()
    const oldRecord = await this.get(name)
    if (startedAt === undefined) {
      await this.db.run(
        `UPDATE ${this.tableName} SET status = ? WHERE name = ?`,
        [status, name]
      )
    } else {
      await this.db.run(
        `UPDATE ${this.tableName} SET status = ?, started_at = ? WHERE name = ?`,
        [status, startedAt, name]
      )
    }
    const newRecord = await this.get(name)
    await saveUpdateHistory(
      this.db,
      this.realmName,
      this.makeId.generateIdStr(),
      null,
      name,
      oldRecord,
      newRecord
    )
  }

  async updatePosition(name: string, currentPosition: string | null): Promise<void> {
    await this.init()
    await this.db.run(
      `UPDATE ${this.tableName} SET current_position = ? WHERE name = ?`,
      [currentPosition, name]
    )
  }

  async updateLastError(name: string, lastError: string | null): Promise<void> {
    await this.init()
    await this.db.run(
      `UPDATE ${this.tableName} SET last_error = ? WHERE name = ?`,
      [lastError, name]
    )
  }

  async startActivation(name: string, startedAt: number = Date.now()): Promise<StorageActivation> {
    await this.init()
    const record = await this.get(name)
    if (!record) {
      throw new Error(`Storage projection not registered: ${name}`)
    }
    if (record.status === StorageStatus.Refreshing) {
      throw new Error(`Storage projection activation already running: ${name}`)
    }
    if (record.status === StorageStatus.Online) {
      return {
        name,
        status: StorageStatus.Online,
        activationTarget: record.currentPosition,
        started: false,
      }
    }

    const activationTarget = await latestRealmEventId(this.db, this.realmName)
    await this.db.run(
      `UPDATE ${this.tableName}
        SET status = ?, started_at = ?, last_error = NULL
        WHERE name = ?`,
      [StorageStatus.Refreshing, startedAt, name]
    )

    const newRecord = await this.get(name)
    await saveUpdateHistory(
      this.db,
      this.realmName,
      this.makeId.generateIdStr(),
      null,
      name,
      record,
      newRecord
    )

    return {
      name,
      status: StorageStatus.Refreshing,
      activationTarget,
      started: true,
    }
  }

  async reset(name: string): Promise<void> {
    await this.init()
    const oldRecord = await this.get(name)
    await this.db.run(
      `UPDATE ${this.tableName}
        SET current_position = NULL, last_error = NULL, status = ?, started_at = NULL
        WHERE name = ?`,
      [StorageStatus.Inactive, name]
    )
    const newRecord = await this.get(name)
    await saveUpdateHistory(
      this.db,
      this.realmName,
      this.makeId.generateIdStr(),
      null,
      name,
      oldRecord,
      newRecord
    )
  }
}
