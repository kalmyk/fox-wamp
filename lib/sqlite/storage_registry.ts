import * as sqlite from 'sqlite'

import { StorageRecord, StorageStatus } from '../types'

export type StorageRegistration = {
  name: string
  realmName: string
  uriPattern: string
  storageType: string
}

function mapStorageRecord(row: any): StorageRecord {
  return {
    name: row.name,
    realmName: row.realm_name,
    uriPattern: row.uri_pattern,
    storageType: row.storage_type,
    startedAt: row.started_at === null || row.started_at === undefined ? null : row.started_at,
    status: row.status,
    currentPosition: row.current_position === undefined ? null : row.current_position,
    lastError: row.last_error === undefined ? null : row.last_error,
  }
}

export async function createStorageRegistryTables(db: sqlite.Database): Promise<void> {
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_storages (
      name TEXT PRIMARY KEY,
      realm_name TEXT NOT NULL,
      uri_pattern TEXT NOT NULL,
      storage_type TEXT NOT NULL,
      started_at INTEGER,
      status TEXT NOT NULL CHECK(status IN ('inactive', 'refreshing', 'online', 'failed')) DEFAULT 'inactive',
      current_position TEXT,
      last_error TEXT
    );`
  )
}

export class StorageRegistry {
  private db: sqlite.Database

  constructor(db: sqlite.Database) {
    this.db = db
  }

  async init(): Promise<void> {
    await createStorageRegistryTables(this.db)
  }

  async register(storage: StorageRegistration): Promise<void> {
    await this.init()
    await this.db.run(
      `INSERT OR IGNORE INTO kv_storages
        (name, realm_name, uri_pattern, storage_type, started_at, status, current_position, last_error)
        VALUES (?, ?, ?, ?, NULL, ?, NULL, NULL)`,
      [
        storage.name,
        storage.realmName,
        storage.uriPattern,
        storage.storageType,
        StorageStatus.Inactive,
      ]
    )
  }

  async get(name: string): Promise<StorageRecord | null> {
    await this.init()
    const row = await this.db.get(
      `SELECT name, realm_name, uri_pattern, storage_type, started_at, status, current_position, last_error
        FROM kv_storages
        WHERE name = ?`,
      [name]
    )
    return row ? mapStorageRecord(row) : null
  }

  async list(): Promise<StorageRecord[]> {
    await this.init()
    const rows = await this.db.all(
      `SELECT name, realm_name, uri_pattern, storage_type, started_at, status, current_position, last_error
        FROM kv_storages
        ORDER BY name`,
      []
    )
    return rows.map(mapStorageRecord)
  }

  async updateStatus(name: string, status: StorageStatus, startedAt?: number | null): Promise<void> {
    await this.init()
    if (startedAt === undefined) {
      await this.db.run(
        `UPDATE kv_storages SET status = ? WHERE name = ?`,
        [status, name]
      )
      return
    }
    await this.db.run(
      `UPDATE kv_storages SET status = ?, started_at = ? WHERE name = ?`,
      [status, startedAt, name]
    )
  }

  async updatePosition(name: string, currentPosition: string | null): Promise<void> {
    await this.init()
    await this.db.run(
      `UPDATE kv_storages SET current_position = ? WHERE name = ?`,
      [currentPosition, name]
    )
  }

  async updateLastError(name: string, lastError: string | null): Promise<void> {
    await this.init()
    await this.db.run(
      `UPDATE kv_storages SET last_error = ? WHERE name = ?`,
      [lastError, name]
    )
  }

  async reset(name: string): Promise<void> {
    await this.init()
    await this.db.run(
      `UPDATE kv_storages
        SET current_position = NULL, last_error = NULL, status = ?, started_at = NULL
        WHERE name = ?`,
      [StorageStatus.Inactive, name]
    )
  }
}
