import { BaseRealm } from '../realm'
import { DbEngine } from './dbengine'
import { SqliteKvFabric, SqliteKv } from './sqlitekv'
import FoxRouter from '../fox_router'
import { keyDate, ProduceId } from '../masterfree/makeid'
import { DbFactory } from './dbfactory'

export class OneDbRouter extends FoxRouter {
  private makeId: ProduceId
  private modKv: SqliteKvFabric

  constructor (dbFactory: DbFactory) {
    super()
    this.makeId = new ProduceId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()
    this.modKv = new SqliteKvFabric(dbFactory, this.makeId)
  }

  public override createRealm (realmName: string): BaseRealm {
    const realm = new BaseRealm(this, new DbEngine(this.getMakeId(), this.getModKv()))
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.getModKv(), realmName))
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
