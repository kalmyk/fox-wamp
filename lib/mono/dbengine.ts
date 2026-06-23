import * as sqlite from 'sqlite'
import { makeDataSerializable, unSerializeData, BaseEngine, ActorPush, ActorPushKv, SchemaRepositoryLike, IActorPush, isDataFit, KeyValueStorageAbstract } from '../realm'
import * as History from '../sqlite/history'
import { createKvTables, SqliteKvFabric } from '../sqlite/sqlitekv'
import { createStorageRegistryTables } from '../sqlite/storage_registry'
import { ProduceId } from '../masterfree/makeid'
import { KPQueue } from '../masterfree/kpqueue'
import { LocalSegmentPusher } from '../masterfree/storage'
import { errorCodes } from '../realm_error'
import {
  SchemaRepository,
  createSchemaTables,
  extractUrlValues,
  mergeUrlAndBodyPayload
} from '../sqlite/schema_repository'
import { validatePayload } from '../schema_validation'
import { restoreUri } from '../topic_pattern'
import { getBodyValue } from '../tools'

// situable for single-process realm operations
// router all in one: listen for events and save to local file
export class DbEngine extends BaseEngine {
  private idMill: ProduceId
  private modKv: SqliteKvFabric
  private storageTask: LocalSegmentPusher
  private pushQueue: Promise<void> = Promise.resolve()
  private schemaRepo?: SchemaRepository

  private pkq: KPQueue = new KPQueue()
  private resWhen: Map<string, IActorPush[]> = new Map()

  constructor (idMill: ProduceId, modKv: SqliteKvFabric, storageTask: LocalSegmentPusher) {
    super()
    this.idMill = idMill
    this.modKv = modKv
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
            const schemaJson = JSON.parse(schema.schemaJson)
            const urlValues = extractUrlValues(url, schema.urlPattern, schemaJson.primary_key)
            if (!urlValues) {
              actor.rejectCmd('wamp.error.invalid_argument', `URL "${url}" does not match schema pattern "${schema.urlPattern}"`)
              return Promise.resolve()
            }
            const mergedPayload = mergeUrlAndBodyPayload(urlValues, bodyPayload)
            validatePayload(schemaJson, mergedPayload, actor.getUri())
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
    this.cleanupWaiters(sessionId)
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

    this.storageTask.pushLocalEvent(
      this.getRealmName(),
      actor.getUri(),
      actor.getData(),
      actor.getOpt(),
      actor.getSid(),
      id
    )
  }

  public override getKey (uri: string[], cbRow: (key: string[], data: any, eventId: any) => void): Promise<any> {
    const waitKey = this.getRealmName() + '|' + restoreUri(uri)
    return this.pkq.enQueue(waitKey, () => super.getKey(uri, cbRow))
  }

  public override updateKvFromActor (actor: IActorPush): Promise<any> {
    const suri = restoreUri(actor.getUri())
    const waitKey = this.getRealmName() + '|' + suri
    return this.pkq.enQueue(waitKey, async () => {
      const db = await this.modKv.getDb(this.getRealmName())
      await this.applyKvActorLocked(db, suri, actor.getEventId() || '', actor.getData(), actor.getOpt(), actor.getSid(), actor)
    })
  }

  private async applyKvActorLocked (db: sqlite.Database, suri: string, origin: string, data: any, opt: any, sid: string, actor?: IActorPush): Promise<void> {
    const realmName = this.getRealmName()
    const result = await this.modKv.writeKvLocked(db, realmName, suri, origin, data, opt, sid)

    if (result.whenNotMet) {
      if (opt.watch && actor) {
        this.parkActor(suri, actor)
      } else if (actor) {
        actor.rejectCmd(String(errorCodes.ERROR_INVALID_PAYLOAD), 'not accepted')
      }
      return
    }

    if (actor) {
      actor.confirm((actor as any).msg)
    }

    let nextActor = await this.findNextWhenActor(suri, result.newData)
    while (nextActor) {
      await this.applyKvActorLocked(db, suri, nextActor.getEventId() || origin, nextActor.getData(), nextActor.getOpt(), nextActor.getSid(), nextActor)
      const { value: curData } = await this.modKv.getStoredValue(db, realmName, suri)
      nextActor = await this.findNextWhenActor(suri, curData)
    }
  }

  private cleanupWaiters (sessionId: string): void {
    for (const [key, actors] of this.resWhen) {
      for (let i = actors.length - 1; i >= 0; i--) {
        if (actors[i].getSid() === sessionId || !actors[i].isActive()) {
          actors.splice(i, 1)
        }
      }
      if (actors.length === 0) {
        this.resWhen.delete(key)
      }
    }
  }

  private parkActor (suri: string, actor: IActorPush): void {
    const key = this.getRealmName() + '|' + suri
    if (!this.resWhen.has(key)) {
      this.resWhen.set(key, [])
    }
    this.resWhen.get(key)!.push(actor)
  }

  private async findNextWhenActor (suri: string, curData: any): Promise<IActorPush | false> {
    const key = this.getRealmName() + '|' + suri
    const actors = this.resWhen.get(key)
    if (!actors) return false

    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]
      if (!actor.isActive()) {
        actors.splice(i, 1)
        i--
        continue
      }
      if (isDataFit(actor.getOpt().when, curData)) {
        actors.splice(i, 1)
        if (actors.length === 0) {
          this.resWhen.delete(key)
        }
        return actor
      }
    }
    if (actors.length === 0) {
      this.resWhen.delete(key)
    }
    return false
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

export class SqliteKv extends KeyValueStorageAbstract {
  private mod: SqliteKvFabric
  private realmName: string
  private engine: DbEngine

  constructor (mod: SqliteKvFabric, realmName: string, engine: DbEngine) {
    super()
    this.mod = mod
    this.realmName = realmName
    this.engine = engine
  }

  setKeyActor (actor: IActorPush): Promise<any> {
    return this.engine.updateKvFromActor(actor)
  }

  getKey (uri: string[], cbRow: (aKey: string[], data: any, eventId: any) => void): Promise<any> {
    return this.mod.getKey(this.realmName, uri, cbRow)
  }

  eraseSessionData (sessionId: string): Promise<void> {
    return this.mod.eraseSessionData(this.realmName, sessionId, this.runInboundEvent.bind(this))
  }
}
