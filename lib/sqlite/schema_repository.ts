import * as sqlite from 'sqlite'
import * as crypto from 'crypto'
import { SchemaRecord, SchemaStatus } from '../types'
import { ProduceId } from '../masterfree/makeid'
import { createUpdateHistoryTable, saveUpdateHistory } from './update_history'
import { match, defaultParse } from '../topic_pattern'
import { validateSchema as baseValidateSchema, sortKeys } from '../schema_validation'

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
      created_at INTEGER NOT NULL,
      CHECK (status IN ('active', 'deprecated'))
    );`
  )
}

export function generateDataTableName(realmName: string, urlPattern: string, schemaJson: string): string {
  const hash = crypto.createHash('sha256').update(urlPattern + schemaJson).digest('hex').substring(0, 12)
  return `data_${realmName}_${hash}`
}

export function generateSchemaId(realmName: string, urlPattern: string, schemaJson: string): string {
  const hash = crypto.createHash('sha256').update(urlPattern + schemaJson).digest('hex').substring(0, 16)
  return `sch_${realmName}_${hash}`
}

export function generateCreateTableSql(tableName: string, schemaJson: any): string {
  const props = schemaJson.properties
  const pk = schemaJson.primary_key

  const columns = Object.keys(props).map(name => {
    // Basic identifier validation and escaping
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
      throw new Error(`Invalid property name: ${name}`);
    }
    let prop = props[name]
    if (typeof prop === 'string') {
      prop = { type: prop }
    }
    const type = prop.type === 'number' ? 'REAL' : 'TEXT'
    return `"${name}" ${type}${pk.includes(name) ? ' NOT NULL' : ''}`
  })

  // Escape PK columns as well
  const escapedPk = pk.map((name: string) => `"${name}"`)

  return `CREATE TABLE IF NOT EXISTS "${tableName}" (
    ${columns.join(',\n    ')},
    PRIMARY KEY (${escapedPk.join(', ')})
  );`
}

export function parseUrlPatternFields(urlPattern: string): string[] {
  const fieldNames: string[] = [];
  const regex = /\{([^}]+)\}/g;
  let match;
  while ((match = regex.exec(urlPattern)) !== null) {
    fieldNames.push(match[1]);
  }
  return fieldNames;
}

export function extractUrlValues(urlString: string, urlPattern: string): Record<string, string> | null {
  const urlParts = defaultParse(urlString);
  const patternParts = defaultParse(urlPattern);

  if (urlParts.length !== patternParts.length) {
    return null;
  }

  const values: Record<string, string> = {};

  for (let i = 0; i < patternParts.length; i++) {
    const patternPart = patternParts[i];
    const fieldMatch = patternPart.match(/^\{([^}]+)\}$/);

    if (fieldMatch) {
      const fieldName = fieldMatch[1];
      values[fieldName] = urlParts[i];
    } else if (patternPart !== urlParts[i]) {
      return null;
    }
  }

  return values;
}

export function mergeUrlAndBodyPayload(urlValues: Record<string, string>, bodyPayload: any): any {
  if (!bodyPayload || typeof bodyPayload !== 'object') {
    bodyPayload = {};
  }
  return { ...bodyPayload, ...urlValues };
}

export function matchUrlPattern(urlParts: string[], patternParts: string[]): boolean {
  if (urlParts.length !== patternParts.length) {
    return false;
  }

  for (let i = 0; i < patternParts.length; i++) {
    const pattern = patternParts[i];
    const fieldMatch = pattern.match(/^\{([^}]+)\}$/);

    if (fieldMatch) {
      // {field} placeholder matches any value
      continue;
    } else if (pattern !== urlParts[i]) {
      // Literal match required
      return false;
    }
  }

  return true;
}

export class SchemaRepository {
  private db: sqlite.Database
  private realmName: string
  private makeId: ProduceId
  private cache: SchemaRecord[] | null = null

  constructor(db: sqlite.Database, realmName: string, makeId: ProduceId) {
    this.db = db
    this.realmName = realmName
    this.makeId = makeId
  }

  private validateUrlPattern(schemaJson: any, urlPattern: string): void {
    const patternFields = parseUrlPatternFields(urlPattern)
    for (const pkKey of schemaJson.primary_key) {
      if (!patternFields.includes(pkKey)) {
        throw new Error(`Primary key "${pkKey}" must be present in url_pattern as a placeholder like {${pkKey}}`)
      }
    }
  }

  async register(label: string, urlPattern: string, schemaJson: any): Promise<SchemaRecord> {
    baseValidateSchema(schemaJson)
    this.validateUrlPattern(schemaJson, urlPattern)

    const sortedSchema = sortKeys(schemaJson)
    const schemaStr = JSON.stringify(sortedSchema)
    const schemaId = generateSchemaId(this.realmName, urlPattern, schemaStr)
    const dataTable = generateDataTableName(this.realmName, urlPattern, schemaStr)

    // Check for existing schema by stable ID
    const existing = await this.db.get(
      `SELECT * FROM message_schemas_${this.realmName} WHERE schema_id = ?`,
      [schemaId]
    )

    if (existing) {
      // Schema record with this ID already exists, just return it
      return {
        schemaId: existing.schema_id,
        label: existing.label,
        urlPattern: existing.url_pattern,
        dataTable: existing.data_table,
        schemaJson: existing.schema_json,
        status: existing.status as SchemaStatus,
        createdAt: existing.created_at
      }
    }

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

    // Provision data table within a transaction
    const createTableSql = generateCreateTableSql(dataTable, sortedSchema)

    await this.db.run('BEGIN TRANSACTION')
    try {
      await this.db.run(createTableSql)
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
      await this.db.run('COMMIT')
    } catch (e) {
      await this.db.run('ROLLBACK')
      throw e
    }

    this.cache = null
    await this.loadCache()

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

  isCacheLoaded(): boolean {
    return this.cache !== null
  }

  findByUrl(url: string[]): SchemaRecord | null {
    if (this.cache === null) {
      throw new Error('Schema cache is not ready. Call loadCache() first.')
    }
    if (this.cache.length === 0) return null

    for (const record of this.cache) {
      const pattern = defaultParse(record.urlPattern)
      if (matchUrlPattern(url, pattern)) {
        return record
      }
    }
    return null
  }

  async loadCache(): Promise<void> {
    const rows = await this.db.all(`SELECT * FROM message_schemas_${this.realmName}`)
    this.cache = rows.map(row => ({
      schemaId: row.schema_id,
      label: row.label,
      urlPattern: row.url_pattern,
      dataTable: row.data_table,
      schemaJson: row.schema_json,
      status: row.status as SchemaStatus,
      createdAt: row.created_at
    }))
  }
}
