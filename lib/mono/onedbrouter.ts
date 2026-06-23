import { BaseRealm } from '../realm'
import { DbEngine, SqliteKv } from './dbengine'
import { SqliteKvFabric } from '../sqlite/sqlitekv'
import FoxRouter from '../fox_router'
import { keyDate, ProduceId } from '../masterfree/makeid'
import { DbFactory } from '../sqlite/dbfactory'
import { LocalSegmentPusher } from '../masterfree/storage'

const noopSegmentPusher: LocalSegmentPusher = { pushLocalEvent () {} }

export class OneDbRouter extends FoxRouter {
  private makeId: ProduceId
  private modKv: SqliteKvFabric
  private storageTask: LocalSegmentPusher = noopSegmentPusher

  constructor (dbFactory: DbFactory) {
    super()
    this.makeId = new ProduceId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()
    this.modKv = new SqliteKvFabric(dbFactory, this.makeId)
  }

  public setStorageTask (storageTask: LocalSegmentPusher): void {
    this.storageTask = storageTask
  }

  public override createRealm (realmName: string): BaseRealm {
    const engine = new DbEngine(this.getMakeId(), this.getModKv(), this.storageTask)
    const realm = new BaseRealm(this, engine)
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.getModKv(), realmName, engine))
    return realm
  }

  public getMakeId (): ProduceId {
    return this.makeId
  }

  public getModKv (): SqliteKvFabric {
    return this.modKv
  }

  public startActualizePrefixTimer (): void {
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 60000)
  }
}
