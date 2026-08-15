import * as sqlite from 'sqlite'
import { BaseRealm } from '../realm'
import { ProjectionListener } from '../sqlite/projection_listener'
import { StorageRegistry } from '../sqlite/storage_registry'
import { SchemaRepository } from '../sqlite/schema_repository'
import { StorageRecord } from '../types'
import { StorageStatus } from '../types'
import { ProduceId } from './makeid'
import { AdminEvent, AdminEventShardEntry, SegmentRecord } from './hyper.h'
import { getConfigInstance } from './config'
import { listSegments } from '../sqlite/segment_registry'

export class AdminApiServer {
  private realmName: string
  private db: sqlite.Database
  private projectionListener: ProjectionListener
  private makeId: ProduceId
  private schemaRepo: SchemaRepository

  constructor(realm: BaseRealm, realmName: string, db: sqlite.Database, projectionListener: ProjectionListener, makeId: ProduceId) {
    this.realmName = realmName
    this.db = db
    this.projectionListener = projectionListener
    this.makeId = makeId

    // Reuse the realm engine's own SchemaRepository instance rather than creating a
    // fresh one. BaseRealm wires that exact instance into its SchemaChecker (see
    // registerSchemaRepository() in lib/realm.ts), which validates publishes/calls
    // against schemas at ingest time. A separate instance here would register schemas
    // into a cache the live SchemaChecker never sees, so publish-time validation would
    // silently never trigger for schemas added through this API (only lazily, much
    // later, when a KV projection backfills/activates and fails).
    const engineRepo = realm.getEngine().getSchemaRepository() as SchemaRepository | undefined
    this.schemaRepo = engineRepo || new SchemaRepository(db, realmName, makeId)

    // Use the realm's shared api client so registrations share its session
    const api = realm.api()
    this._register(api)
  }

  private _register(api: any): void {
    api.register(AdminEvent.KV_LIST, async () => {
      const registry = new StorageRegistry(this.db, this.realmName, this.makeId)
      return { storages: await registry.list() }
    })

    api.register(AdminEvent.KV_ADD, async ({ name, schemaId }: { name: string; schemaId: string }) => {
      const schemaRecord = await this.schemaRepo.get(schemaId)
      if (!schemaRecord) {
        throw new Error(`Schema not found: ${schemaId}`)
      }
      const registry = new StorageRegistry(this.db, this.realmName, this.makeId)
      await registry.register({ name, uriPattern: schemaRecord.urlPattern, schemaId })
      const record = await registry.get(name) as StorageRecord
      return { name: record.name, schemaId: record.schemaId, uriPattern: record.uriPattern, status: record.status }
    })

    api.register(AdminEvent.KV_ACTIVATE, async ({ name }: { name: string }) => {
      const activation = await this.projectionListener.startActivation(this.realmName, name)
      return { status: activation.status, activationTarget: activation.activationTarget }
    })

    api.register(AdminEvent.KV_RESET, async ({ name }: { name: string }) => {
      await this.projectionListener.resetProjection(this.realmName, name)
      return { status: StorageStatus.Inactive }
    })

    api.register(AdminEvent.SCHEMA_LIST, async () => {
      return { schemas: await this.schemaRepo.list() }
    })

    api.register(AdminEvent.SCHEMA_ADD, async ({ label, urlPattern, schema }: { label: string; urlPattern: string; schema: object }) => {
      const record = await this.schemaRepo.register(label, urlPattern, schema)
      return { schemaId: record.schemaId, dataTable: record.dataTable }
    })

    api.register(AdminEvent.SCHEMA_DROP, async ({ schemaId }: { schemaId: string }) => {
      const registry = new StorageRegistry(this.db, this.realmName, this.makeId)
      const storages = await registry.list()
      const blocking = storages.filter(s =>
        s.schemaId === schemaId &&
        (s.status === StorageStatus.Online || s.status === StorageStatus.Refreshing)
      )
      if (blocking.length > 0) {
        throw new Error(`Cannot drop schema: ${blocking.length} active projection(s) depend on it`)
      }
      await this.schemaRepo.deprecate(schemaId)
      return { status: 'deprecated' }
    })

    api.register(AdminEvent.EVENT_SHARD_LIST, () => {
      const config = getConfigInstance()
      const eventNodes = config.getEventNodes()
      if (!eventNodes) return { shards: [] }
      const shards: AdminEventShardEntry[] = []
      for (const nodeId of Object.keys(eventNodes)) {
        const node = eventNodes[nodeId]
        if (!node || !Array.isArray(node.shards)) continue
        for (const shardTag of node.shards) {
          shards.push({ shardTag, nodeId, host: node.host, port: node.port })
        }
      }
      shards.sort((a, b) => a.shardTag - b.shardTag)
      return { shards }
    })

    api.register(AdminEvent.SEGMENT_LIST, async () => {
      const rows = await listSegments(this.db, this.realmName)
      const segments: SegmentRecord[] = rows.map(row => ({
        advanceOwner: row.advance_owner,
        advanceStamp: row.advance_stamp,
        shardTag: row.shard_tag,
        segmentId: row.segment_id,
        msgCount: row.msg_count,
        crc32: row.crc32,
        status: row.status,
      }))
      return { segments }
    })
  }
}
