import * as sqlite from 'sqlite'
import { BaseRealm } from '../realm'
import { ProjectionListener } from '../sqlite/projection_listener'
import { StorageRegistry } from '../sqlite/storage_registry'
import { SchemaRepository } from '../sqlite/schema_repository'
import { StorageStatus } from '../types'
import { ProduceId } from './makeid'
import { AdminEvent } from './hyper.h'

export class AdminApiServer {
  private realmName: string
  private db: sqlite.Database
  private projectionListener: ProjectionListener
  private makeId: ProduceId

  constructor(realm: BaseRealm, realmName: string, db: sqlite.Database, projectionListener: ProjectionListener, makeId: ProduceId) {
    this.realmName = realmName
    this.db = db
    this.projectionListener = projectionListener
    this.makeId = makeId

    // Use the realm's shared api client so registrations share its session
    const api = realm.api()
    this._register(api)
  }

  private _register(api: any): void {
    api.register(AdminEvent.KV_LIST, async () => {
      const registry = new StorageRegistry(this.db, this.realmName, this.makeId)
      return { storages: await registry.list() }
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
      const repo = new SchemaRepository(this.db, this.realmName, this.makeId)
      return { schemas: await repo.list() }
    })

    api.register(AdminEvent.SCHEMA_ADD, async ({ label, urlPattern, schema }: { label: string; urlPattern: string; schema: object }) => {
      const repo = new SchemaRepository(this.db, this.realmName, this.makeId)
      const record = await repo.register(label, urlPattern, schema)
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
      const repo = new SchemaRepository(this.db, this.realmName, this.makeId)
      await repo.deprecate(schemaId)
      return { status: 'deprecated' }
    })
  }
}
