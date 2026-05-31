import { makeDataSerializable, unSerializeData, BaseEngine, ActorPush, ActorPushKv } from '../realm'
import * as History from './history'
import { createKvTables, SqliteKvFabric } from './sqlitekv'
import { createStorageRegistryTables } from './storage_registry'
import { ProduceId } from '../masterfree/makeid'

export class DbEngine extends BaseEngine {
  private idMill: ProduceId
  private modKv: SqliteKvFabric
  private pushQueue: Promise<void> = Promise.resolve()

  constructor (idMill: ProduceId, modKv: SqliteKvFabric) {
    super()
    this.idMill = idMill
    this.modKv = modKv
  }

  public override async launchEngine (realmName: string): Promise<void> {
    await super.launchEngine(realmName)

    const db = await this.modKv.getDb(realmName)
    await History.createHistoryTables(db, realmName)
    await createKvTables(db, realmName)
    await createStorageRegistryTables(db, realmName)
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

  // @return promise
  public override doPush (actor: ActorPush): Promise<void> {
    const runPush = () => this.saveHistory(actor).then(() => {
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

    const result = this.pushQueue.then(runPush, runPush)
    this.pushQueue = result.catch(() => {})
    return result
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
      return History.saveEventHistory(
        db,
        this.getRealmName(),
        id,
        0,  // todo: shardId
        actor.getUri(),
        makeDataSerializable(actor.getData()),
        actor.getOpt()
      )
    }
  }

  public override async getHistoryAfter (after: string, uri: any, cbRow: (row: any) => void): Promise<any> {
    const db = await this.modKv.getDb(this.getRealmName())
    return History.getEventHistory(
      db,
      this.getRealmName(),
      { fromId: after, uri },
      (event: any) => {
        cbRow({
          qid: event.id,
          uri: event.uri,
          data: unSerializeData(event.body)
        })
      }
    )
  }
}
