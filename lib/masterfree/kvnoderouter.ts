import { Router } from '../router'
import { BaseRealm } from '../realm'
import { DbEngine, SqliteKv } from '../mono/dbengine'
import { SqliteKvFabric } from '../sqlite/sqlitekv'
import { ProjectionListener } from '../sqlite/projection_listener'
import { AdminApiServer } from './admin_api'
import { ProduceId } from './makeid'
import { INTRA_REALM_NAME } from './hyper.h'

// Router of a standalone KV-node process (bin/masterfree/kvnode.ts). Mirrors OneDbRouter's
// createRealm/initRealm pattern: Router.getRealm() lazily calls both the first time any session
// logs into a realm name it has not seen, so a realm's admin surface is bootstrapped by the first
// admin login — no "realm created" announcement is needed anywhere in the cluster.
//
// One ProjectionListener serves every realm (it groups a SEGMENT_COMMITTED batch per realm
// itself), so it is built once by the caller and shared into each realm's AdminApiServer.
export class KvNodeRouter extends Router {
  private nodeId: string
  private modKv: SqliteKvFabric
  private projectionListener: ProjectionListener
  private makeId: ProduceId

  constructor (nodeId: string, modKv: SqliteKvFabric, projectionListener: ProjectionListener, makeId: ProduceId) {
    super()
    this.setId(nodeId)
    this.nodeId = nodeId
    this.modKv = modKv
    this.projectionListener = projectionListener
    this.makeId = makeId
  }

  public override createRealm (realmName: string): BaseRealm {
    const engine = new DbEngine(this.makeId, this.modKv)
    const realm = new BaseRealm(this, engine)
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.modKv, realmName, engine))
    return realm
  }

  public override async initRealm (realmName: string, realm: BaseRealm): Promise<void> {
    await super.initRealm(realmName, realm)
    if (realmName !== INTRA_REALM_NAME) {
      new AdminApiServer(realm, realmName, this.modKv.getDbFactory().getMainDb(), this.projectionListener, this.makeId, this.nodeId)
    }
  }

  public getProjectionListener (): ProjectionListener {
    return this.projectionListener
  }
}
