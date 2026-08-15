import * as sqlite from 'sqlite'
import { CommittedSegmentEvent, CommittedSegmentRecord, SegmentCommittedSource, SEGMENT_COMMITTED } from '../masterfree/storage'
import { StorageRegistry, StorageActivation } from './storage_registry'
import { SchemaRepository } from './schema_repository'
import { StorageStatus, StorageRecord } from '../types'
import { match, defaultParse } from '../topic_pattern'
import { getPayload, validatePayload, SchemaValidationError } from '../schema_validation'
import { getMergedBody } from '../tools'
import { unSerializeData } from '../realm'
import { ProduceId } from '../masterfree/makeid'
import { getEventHistory, forEachRealm } from './history'

export class KvProjection {
  private db: sqlite.Database
  private record: StorageRecord
  private schemaJson: any
  private dataTable: string

  constructor(db: sqlite.Database, record: StorageRecord, schemaJson: any, dataTable: string) {
    this.db = db
    this.record = record
    this.schemaJson = schemaJson
    this.dataTable = dataTable
  }

  async applyEvent(record: CommittedSegmentRecord): Promise<string | null> {
    if (!record.opt.retain) return null

    // Verify URI match
    if (!match(defaultParse(record.uri.join('.')), defaultParse(this.record.uriPattern))) {
      return null
    }

    // record.data comes straight from stored/wire history, where MQTT-originated
    // bodies are wrapped as { p64: base64 } (see makeDataSerializable/unSerializeData
    // in lib/realm.ts) — unwrap before interpreting it as a schema payload.
    const data = unSerializeData(record.data)
    const payload = getPayload(data)
    const allData = getMergedBody(data)

    // Handle deletion (retained-clean)
    if (payload === null || payload === undefined) {
      if (this.schemaJson) {
        const pk = this.schemaJson.primary_key
        const where = pk.map((k: string) => `"${k}" = ?`).join(' AND ')
        
        // Use URI-derived primary keys if mapping exists
        let values = pk.map((k: string) => allData ? allData[k] : undefined)
        
        if (this.schemaJson.key_from_uri) {
          const uriParts = defaultParse(record.uri.join('.'))
          for (const key of pk) {
            const uriIndex = this.schemaJson.key_from_uri[key]
            if (uriIndex !== undefined && uriParts[uriIndex] !== undefined) {
              values[pk.indexOf(key)] = uriParts[uriIndex]
            }
          }
        }

        if (values.every((v: any) => v !== undefined && v !== null)) {
          await this.db.run(`DELETE FROM "${this.dataTable}" WHERE ${where}`, values)
        }
      }
      return record.eventId
    }

    // Validate payload against schema if present. A schema-nonconforming event is
    // expected to happen — e.g. the schema was registered after older events were
    // already published — so it's skipped with a warning rather than failing the
    // whole projection. Any other kind of error (bugs, DB failures, ...) still
    // propagates and fails the projection as before.
    if (this.schemaJson) {
      try {
        validatePayload(this.schemaJson, payload, defaultParse(record.uri.join('.')))
      } catch (e) {
        if (e instanceof SchemaValidationError) {
          await this.recordWarning(record.eventId, record.uri.join('.'), e.message)
          return record.eventId
        }
        throw e
      }
    }

    // Apply to generated table
    const props = this.schemaJson.properties
    const columns = Object.keys(props).filter(k => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(k))
    
    const placeholders = columns.map(() => '?').join(', ')
    const colNames = columns.map(c => `"${c}"`).join(', ')
    const values = columns.map(c => payload[c])

    const sql = `INSERT OR REPLACE INTO "${this.dataTable}" (${colNames}) VALUES (${placeholders})`
    await this.db.run(sql, values)
    
    return record.eventId
  }

  async recordWarning(eventId: string, uri: string, message: string): Promise<void> {
    const warning = `skipped event ${eventId} at "${uri}": ${message}`
    console.warn(`[kv:${this.record.name}] ${warning}`)
    await this.db.run(
      `UPDATE storage_desc_${this.record.realmName} SET skipped_count = skipped_count + 1, last_warning = ? WHERE name = ?`,
      [warning, this.record.name]
    )
  }

  async advancePosition(eventId: string): Promise<void> {
    if (eventId === this.record.currentPosition) return
    await this.db.run(
      `UPDATE storage_desc_${this.record.realmName} SET current_position = ? WHERE name = ?`,
      [eventId, this.record.name]
    )
    this.record.currentPosition = eventId
  }

  async setStatus(status: StorageStatus, error?: string): Promise<void> {
    await this.db.run(
      `UPDATE storage_desc_${this.record.realmName} SET status = ?, last_error = ? WHERE name = ?`,
      [status, error || null, this.record.name]
    )
    this.record.status = status
  }
}

export class ProjectionListener {
  private source: SegmentCommittedSource
  private db: sqlite.Database
  private registries: Map<string, StorageRegistry> = new Map()
  private schemas: Map<string, SchemaRepository> = new Map()
  private makeId: ProduceId

  constructor(source: SegmentCommittedSource, db: sqlite.Database, makeId: ProduceId) {
    this.source = source
    this.db = db
    this.makeId = makeId

    this.source.on(SEGMENT_COMMITTED, (event: CommittedSegmentEvent) => {
      this.handleSegmentCommitted(event).catch(err => {
        console.error("Error handling segment committed in ProjectionListener:", err)
      })
    })
  }

  async activateProjection(realmName: string, name: string): Promise<void> {
    const registry = await this.getRegistry(realmName)
    const activation = await registry.startActivation(name)
    if (!activation.started) return
    await this._runActivation(realmName, name, activation.activationTarget)
  }

  async startActivation(realmName: string, name: string): Promise<StorageActivation> {
    const registry = await this.getRegistry(realmName)
    const activation = await registry.startActivation(name)
    if (activation.started) {
      this._runActivation(realmName, name, activation.activationTarget).catch(err => {
        console.error(`Background activation failed for ${name}:`, err)
      })
    }
    return activation
  }

  private async _runActivation(realmName: string, name: string, activationTarget: string | null): Promise<void> {
    const registry = await this.getRegistry(realmName)
    const projRecord = await registry.get(name)
    if (!projRecord) throw new Error('Projection not found')

    try {
      const schemaRepo = await this.getSchemaRepo(realmName)
      const schema = await schemaRepo.get(projRecord.schemaId)
      if (!schema) throw new Error(`Schema not found for projection: ${projRecord.schemaId}`)

      const projection = new KvProjection(this.db, projRecord, JSON.parse(schema.schemaJson), schema.dataTable)

      if (activationTarget) {
        await getEventHistory(this.db, realmName, { toId: activationTarget }, async (event) => {
          await projection.applyEvent({
            eventId: event.id,
            realm: realmName,
            uri: event.uri,
            data: event.body,
            opt: event.opt,
            sid: '',
            shard: event.shard
          })
          await projection.advancePosition(event.id)
        })
      }

      await projection.setStatus(StorageStatus.Online)
    } catch (e) {
      await registry.updateStatus(name, StorageStatus.Failed)
      await registry.updateLastError(name, (e as Error).message)
      throw e
    }
  }

  async resetProjection(realmName: string, name: string): Promise<void> {
    const registry = await this.getRegistry(realmName)
    const projRecord = await registry.get(name)
    if (!projRecord) throw new Error('Projection not found')

    const schemaRepo = await this.getSchemaRepo(realmName)
    const schema = await schemaRepo.get(projRecord.schemaId)
    
    // Clear data table
    if (schema) {
      await this.db.run(`DELETE FROM "${schema.dataTable}"`)
    }

    await registry.reset(name)
  }

  private async getRegistry(realmName: string): Promise<StorageRegistry> {
    let reg = this.registries.get(realmName)
    if (!reg) {
      reg = new StorageRegistry(this.db, realmName, this.makeId)
      this.registries.set(realmName, reg)
    }
    return reg
  }

  private async getSchemaRepo(realmName: string): Promise<SchemaRepository> {
    let repo = this.schemas.get(realmName)
    if (!repo) {
      repo = new SchemaRepository(this.db, realmName, this.makeId)
      this.schemas.set(realmName, repo)
    }
    return repo
  }

  public async handleSegmentCommitted(event: CommittedSegmentEvent): Promise<void> {
    const realmEvents = new Map<string, CommittedSegmentRecord[]>()
    for (const record of event.events) {
      let list = realmEvents.get(record.realm)
      if (!list) {
        list = []
        realmEvents.set(record.realm, list)
      }
      list.push(record)
    }

    // Requirement: EVERY online projection advances on each SEGMENT_COMMITTED
    // We iterate over all realms known to have history tables
    await forEachRealm(this.db, async (realmName: string) => {
      const registry = await this.getRegistry(realmName)
      const schemaRepo = await this.getSchemaRepo(realmName)
      const activeProjections = (await registry.list()).filter(p => p.status === StorageStatus.Online)

      if (activeProjections.length === 0) return

      const records = realmEvents.get(realmName) || []

      for (const projRecord of activeProjections) {
        const schema = await schemaRepo.get(projRecord.schemaId)
        if (!schema) continue

        const projection = new KvProjection(this.db, projRecord, JSON.parse(schema.schemaJson), schema.dataTable)
        let lastAppliedId: string | null = null

        for (const record of records) {
          try {
            const appliedId = await projection.applyEvent(record)
            if (appliedId) lastAppliedId = appliedId
          } catch (e) {
             console.error(`Runtime projection error for ${projRecord.name}:`, (e as Error).message)
             await projection.setStatus(StorageStatus.Failed, (e as Error).message)
             // Stop processing this projection for now
             lastAppliedId = null
             break
          }
        }
        
        // Only advance if it didn't just fail
        if (lastAppliedId) {
          await projection.advancePosition(lastAppliedId)
        } else if (records.length === 0 || lastAppliedId === null) {
           // If no events matched or no events in segment, use segment ID as watermark
           // But only if we didn't just fail (status check)
           const currentRecord = await registry.get(projRecord.name)
           if (currentRecord && currentRecord.status === StorageStatus.Online) {
             await projection.advancePosition(event.segment)
           }
        }
      }
    })
  }
}
