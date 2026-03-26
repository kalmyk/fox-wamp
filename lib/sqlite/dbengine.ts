import { makeDataSerializable, unSerializeData, BaseEngine, ActorPush } from '../realm'
import * as History from './history'
import { createKvTables, SqliteKvFabric } from './sqlitekv'
import { ProduceId } from '../masterfree/makeid'

export class DbEngine extends BaseEngine {
  private idMill: ProduceId
  private modKv: SqliteKvFabric

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
  }

  // @return promise
  public override doPush (actor: ActorPush): Promise<void> {
    return this.saveHistory(actor).then(() => {
      this.disperseToSubs(actor.getEvent())
      if (actor.getOpt().retain) {
        return this.updateKvFromActor(actor)
      } else {
        actor.confirm(actor.msg)
        return Promise.resolve()
      }
    })
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
