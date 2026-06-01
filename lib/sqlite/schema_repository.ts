import * as sqlite from 'sqlite'
import * as crypto from 'crypto'
import { SchemaRecord, SchemaStatus } from '../types'
import { ProduceId } from '../masterfree/makeid'
import { createUpdateHistoryTable, saveUpdateHistory } from './update_history'
import { match, defaultParse } from '../topic_pattern'

export async function createSchemaTables(db: sqlite.Database, realmName: string) {
  await createUpdateHistoryTable(db, realmName)
  await db.run(
    `CREATE TABLE IF NOT EXISTS message_schemas_${realmName} (
      schema_id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      url_pattern TEXT NOT NULL,
      data_table TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );`
  )
}

export function generateDataTableName(realmName: string, schemaJson: string): string {
  const hash = crypto.createHash('sha256').update(schemaJson).digest('hex').substring(0, 12)
  return `data_${realmName}_${hash}`
}

export function generateCreateTableSql(tableName: string, schemaJson: any): string {
  const props = schemaJson.properties
  const pk = schemaJson.primary_key

  const columns = Object.keys(props).map(name => {
    const type = props[name] === 'number' ? 'REAL' : 'TEXT'
    return `${name} ${type}${pk.includes(name) ? ' NOT NULL' : ''}`
  })

  return `CREATE TABLE IF NOT EXISTS ${tableName} (
    ${columns.join(',\n    ')},
    PRIMARY KEY (${pk.join(', ')})
  );`
}

export class SchemaRepository {
  private db: sqlite.Database
  private realmName: string
  private makeId: ProduceId

  constructor(db: sqlite.Database, realmName: string, makeId: ProduceId) {
    this.db = db
    this.realmName = realmName
    this.makeId = makeId
  }

  async register(label: string, urlPattern: string, schemaJson: any): Promise<SchemaRecord> {
    const schemaStr = JSON.stringify(schemaJson)
    const schemaId = this.makeId.generateIdStr()
    const dataTable = generateDataTableName(this.realmName, schemaStr)
    const createdAt = Date.now()
    
    const record: SchemaRecord = {
      schemaId,
      label,
      urlPattern,
      dataTable,
      schemaJson: schemaStr,
      status: SchemaStatus.Active,
      createdAt
    }

    await this.db.run(
      `INSERT INTO message_schemas_${this.realmName} (
        schema_id, label, url_pattern, data_table, schema_json, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        record.schemaId,
        record.label,
        record.urlPattern,
        record.dataTable,
        record.schemaJson,
        record.status,
        record.createdAt
      ]
    )

    await saveUpdateHistory(
      this.db,
      this.realmName,
      this.makeId.generateIdStr(),
      null,
      `schema:${schemaId}`,
      null,
      record
    )

    return record
  }

  async get(schemaId: string): Promise<SchemaRecord | null> {
    const row = await this.db.get(
      `SELECT * FROM message_schemas_${this.realmName} WHERE schema_id = ?`,
      [schemaId]
    )
    if (!row) return null
    return {
      schemaId: row.schema_id,
      label: row.label,
      urlPattern: row.url_pattern,
      dataTable: row.data_table,
      schemaJson: row.schema_json,
      status: row.status as SchemaStatus,
      createdAt: row.created_at
    }
  }

  async findByUrl(url: string): Promise<SchemaRecord | null> {
    const rows = await this.db.all(`SELECT * FROM message_schemas_${this.realmName}`)
    const targetTopic = defaultParse(url)
    
    for (const row of rows) {
      const pattern = defaultParse(row.url_pattern)
      if (match(targetTopic, pattern)) {
        return {
          schemaId: row.schema_id,
          label: row.label,
          urlPattern: row.url_pattern,
          dataTable: row.data_table,
          schemaJson: row.schema_json,
          status: row.status as SchemaStatus,
          createdAt: row.created_at
        }
      }
    }
    return null
  }
}
