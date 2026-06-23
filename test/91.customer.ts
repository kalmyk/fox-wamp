import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { DbEngine, SqliteKv } from '../lib/mono/dbengine'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { ProduceId } from '../lib/masterfree/makeid'
import { SchemaRepository } from '../lib/sqlite/schema_repository'
import { StorageRegistry } from '../lib/sqlite/storage_registry'
import { ProjectionListener } from '../lib/sqlite/projection_listener'
import { HyperClient } from '../lib/hyper/client'

const REALM = 'realm1'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('91.customer', () => {
  let db: sqlite.Database
  let router: Router
  let realm: BaseRealm
  let api: HyperClient
  let schemaRepo: SchemaRepository
  let registry: StorageRegistry
  let projectionListener: ProjectionListener
  let dbFactory: DbFactory

  beforeEach(async () => {
    db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    dbFactory = new DbFactory('/tmp/test-91.db')
    dbFactory.setMainDb(db)

    const makeId = new ProduceId(() => 'cust-')
    makeId.actualizePrefix()

    const modKv = new SqliteKvFabric(dbFactory, makeId)
    const dbEngine = new DbEngine(makeId, modKv)

    router = new Router()
    realm = new BaseRealm(router, dbEngine)
    realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, REALM, dbEngine))
    await router.initRealm(REALM, realm)

    realm.getEngine().retainedEventWaitTimeoutMs = 500

    schemaRepo = new SchemaRepository(db, REALM, makeId)
    registry = new StorageRegistry(db, REALM, makeId)
    projectionListener = new ProjectionListener(dbFactory, db, makeId)

    api = realm.api() as HyperClient
  })

  afterEach(async () => {
    await api.session().cleanup()
  })

  it('full customer lifecycle: publish, schema, activate, delayed subscribe', async () => {
    // Step 1: Push customer.id1 retained event (trace so it lands in event_history)
    await api.publish('customer.id1', { id: 'id1', name: 'Alice', credit: 100 }, {
      retain: true,
      trace: true,
      acknowledge: true
    })

    const history = await db.all(`SELECT * FROM event_history_${REALM}`)
    expect(history).to.have.lengthOf(1)
    expect(history[0].msg_uri).to.include('id1')

    // Step 2: Create customer schema (id, name, credit)
    const schema = await schemaRepo.register('customer', 'customer.*', {
      properties: { id: 'string', name: 'string', credit: 'number' },
      primary_key: ['id']
    })
    expect(schema.schemaId).to.be.a('string')
    expect(schema.dataTable).to.be.a('string')

    // Step 3: Register projection and validate table was created
    await registry.register({
      name: 'customer-proj',
      uriPattern: 'customer.*',
      schemaId: schema.schemaId
    })

    const tableRow = await db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [schema.dataTable]
    )
    expect(tableRow).to.exist

    // Step 4: Activate projection — catch-up replay populates id1
    await projectionListener.activateProjection(REALM, 'customer-proj')

    const rowsAfterActivation = await db.all(`SELECT * FROM "${schema.dataTable}"`)
    expect(rowsAfterActivation).to.have.lengthOf(1)
    expect(rowsAfterActivation[0].id).to.equal('id1')
    expect(rowsAfterActivation[0].name).to.equal('Alice')

    // Step 5: Push customer.id2, receive event id
    const eventId = await api.publish('customer.id2', { id: 'id2', name: 'Bob', credit: 200 }, {
      retain: true,
      acknowledge: true
    })
    expect(eventId).to.be.a('string')

    // Step 6: Subscribe for customer.id2 with after delay for event id
    const events: any[] = []
    await api.subscribe('customer.id2', event => events.push(event), {
      retained: true,
      after: eventId
    })
    await sleep(50)

    // received data is the same as sent
    expect(events).to.have.lengthOf(1)
    expect(events[0]).to.deep.include({ id: 'id2', name: 'Bob', credit: 200 })

    // verify that id2 is in the projection table
    const allRows = await db.all(`SELECT * FROM "${schema.dataTable}"`)
    expect(allRows).to.have.lengthOf(2)
    const id2Row = allRows.find((r: any) => r.id === 'id2')
    expect(id2Row).to.exist
    expect(id2Row.name).to.equal('Bob')
    expect(id2Row.credit).to.equal(200)
  })
})
