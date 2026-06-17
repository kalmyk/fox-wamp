import { makeDataSerializable, unSerializeData, BaseEngine, ActorPush, ActorPushKv, SchemaRepositoryLike } from '../realm'
import * as History from './history'
import { createKvTables, SqliteKvFabric } from './sqlitekv'
import { createStorageRegistryTables } from './storage_registry'
import { ProduceId } from '../masterfree/makeid'
import { StorageTask } from '../masterfree/storage'
import {
  SchemaRepository,
  createSchemaTables,
  extractUrlValues,
  mergeUrlAndBodyPayload
} from './schema_repository'
import { validatePayload } from '../schema_validation'
import { restoreUri } from '../topic_pattern'
import { getBodyValue } from '../tools'

export class DbEngine extends BaseEngine {
  private idMill: ProduceId
  private modKv: SqliteKvFabric
  private pushQueue: Promise<void> = Promise.resolve()
  private schemaRepo?: SchemaRepository
  private storageTask?: StorageTask

  constructor (idMill: ProduceId, modKv: SqliteKvFabric) {
    super()
    this.idMill = idMill
    this.modKv = modKv
  }

  public setStorageTask (storageTask: StorageTask): void {
    this.storageTask = storageTask
  }

  public override async launchEngine (realmName: string): Promise<void> {
    await super.launchEngine(realmName)

    const db = await this.modKv.getDb(realmName)
    await History.createHistoryTables(db, realmName)
    await createKvTables(db, realmName)
    await createStorageRegistryTables(db, realmName)
    await createSchemaTables(db, realmName)

    this.schemaRepo = new SchemaRepository(db, realmName, this.idMill)
    await this.schemaRepo.loadCache()

    await this.modKv.processStaleRecords(
      realmName,
      (sessionId: string, uri: string[], bodyValue: any) => {
        const actor = new ActorPushKv(
          uri as any,
          { kv: bodyValue },
          { sid: sessionId, retain: true, trace: true }
        )
        return this.doPush(actor as any)
      }
    )
  }

  public override getSchemaRepository(): SchemaRepositoryLike | undefined {
    return this.schemaRepo
  }

  // @return promise
  public override doPush (actor: ActorPush): Promise<void> {
    const runPush = () => {
      if (this.schemaRepo) {
        const uri = actor.getUri()
        const url = restoreUri(uri)
        const schema = this.schemaRepo.findByUrl(uri)
        if (schema) {
          try {
            const bodyPayload = getBodyValue(actor.getData())
            const urlValues = extractUrlValues(url, schema.urlPattern)
            if (!urlValues) {
              actor.rejectCmd('wamp.error.invalid_argument', `URL "${url}" does not match schema pattern "${schema.urlPattern}"`)
              return Promise.resolve()
            }
            const mergedPayload = mergeUrlAndBodyPayload(urlValues, bodyPayload)
            validatePayload(JSON.parse(schema.schemaJson), mergedPayload, actor.getUri())
          } catch (e) {
            actor.rejectCmd('wamp.error.invalid_argument', (e as Error).message)
            return Promise.resolve()
          }
        }
      }

      return this.doPushFinal(actor).catch(e => {
        if (!actor.clientNotified) {
          actor.rejectCmd('wamp.error.internal_error', (e as Error).message)
        }
      })
    }

    const result = this.pushQueue.then(runPush, runPush)
    this.pushQueue = result.catch(() => {})
    return result
  }

  private doPushFinal (actor: ActorPush): Promise<void> {
    return this.saveHistory(actor).then(() => {
      this.disperseToSubs(actor.getEvent())
      if (actor.getOpt().retain) {
        return this.updateKvFromActor(actor).then(() => {
          const eventId = actor.getEventId()
          if (eventId) {
            this.resolveRetainedEventWaiters(eventId)
          }
        })
      } else {
        actor.confirm(actor.msg)
        return Promise.resolve()
      }
    })
  }

  public override async cleanupSession(sessionId: string): Promise<any[]> {
    await this.pushQueue
    return super.cleanupSession(sessionId)
  }

  public async saveHistory (actor: ActorPush): Promise<any> {
    const id = this.idMill.generateIdStr()
    actor.setEventId(id)

    if (actor.getOpt().trace) {
      const db = await this.modKv.getDb(this.getRealmName())
      await History.saveEventHistory(
        db,
        this.getRealmName(),
        id,
        0,  // todo: shardId
        actor.getUri(),
        makeDataSerializable(actor.getData()),
        actor.getOpt()
      )
    }

    if (this.storageTask) {
      this.storageTask.pushLocalEvent(
        this.getRealmName(),
        actor.getUri(),
        actor.getData(),
        actor.getOpt(),
        actor.getSid(),
        id
      )
    }
  }

  public override async getHistoryAfter (after: string, uri: any, cbRow: (row: any) => void): Promise<any> {
    const db = await this.modKv.getDb(this.getRealmName())
    return History.getEventHistory(
      db,
      this.getRealmName(),
      { fromId: after, uri },
      async (event: any) => {
        cbRow({
          qid: event.id,
          uri: event.uri,
          data: unSerializeData(event.body)
        })
      }
    )
  }
}
