import { DbFactory } from '../lib/sqlite/dbfactory'
import { scanMaxId } from '../lib/sqlite/history'
import { OneDbRouter } from '../lib/mono/onedbrouter'
import { StorageTask } from '../lib/masterfree/storage'
import { ProjectionListener } from '../lib/sqlite/projection_listener'

async function main() {
  const dbFactory = new DbFactory('../dbfiles/')
  const db = await dbFactory.openMainDatabase('../dbfiles/msgdb.sqlite')

  const maxId = await scanMaxId(db)
  console.log('loaded max id:', maxId)

  const router = new OneDbRouter(dbFactory)
  router.setLogTrace(true)

  const sysRealm = await router.getRealm('sys')
  const storageTask = new StorageTask(sysRealm, dbFactory)
  new ProjectionListener(storageTask, db, router.getMakeId())

  router.startActualizePrefixTimer()
  router.listenWAMP({ port: 9000 })
  router.listenMQTT({ port: 1883 })
  router.listenHyperNet({ port: 1735 })
}

main().then(() => {
  console.log('listen started.')
}, (err: Error) => {
  console.error('ERROR:', err, err.stack)
})
