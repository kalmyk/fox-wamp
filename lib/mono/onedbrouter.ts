import { BaseRealm } from '../realm'
import { DbEngine, SqliteKv } from './dbengine'
import { SqliteKvFabric } from '../sqlite/sqlitekv'
import { ProjectionListener } from '../sqlite/projection_listener'
import { AdminApiServer } from '../masterfree/admin_api'
import FoxRouter from '../fox_router'
import { keyDate, ProduceId } from '../masterfree/makeid'
import { DbFactory } from '../sqlite/dbfactory'
import { INTRA_REALM_NAME } from '../masterfree/hyper.h'

export class OneDbRouter extends FoxRouter {
  private makeId: ProduceId
  private modKv: SqliteKvFabric
  private projectionListener: ProjectionListener

  constructor (dbFactory: DbFactory) {
    super()
    this.makeId = new ProduceId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()
    this.modKv = new SqliteKvFabric(dbFactory, this.makeId)
    this.projectionListener = new ProjectionListener(dbFactory, dbFactory.getMainDb(), this.makeId)
  }

  public override createRealm (realmName: string): BaseRealm {
    const engine = new DbEngine(this.getMakeId(), this.getModKv())
    const realm = new BaseRealm(this, engine)
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.getModKv(), realmName, engine))
    return realm
  }

  public override async initRealm (realmName: string, realm: BaseRealm): Promise<void> {
    await super.initRealm(realmName, realm)
    if (realmName !== INTRA_REALM_NAME) {
      new AdminApiServer(realm, realmName, this.modKv.getDbFactory().getMainDb(), this.projectionListener, this.makeId)
    }
  }

  public getMakeId (): ProduceId {
    return this.makeId
  }

  public getModKv (): SqliteKvFabric {
    return this.modKv
  }

  public getProjectionListener (): ProjectionListener {
    return this.projectionListener
  }

  public startActualizePrefixTimer (): void {
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 60000)
  }
}
