import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'

import { BaseRealm } from '../lib/realm'
import { OneDbRouter } from '../lib/mono/onedbrouter'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { StorageRegistry } from '../lib/sqlite/storage_registry'
import { AdminEvent } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'

const REALM = 'realm1'
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

describe('91.customer', () => {
  let db: sqlite.Database
  let router: OneDbRouter
  let realm: BaseRealm
  let api: HyperClient

  beforeEach(async () => {
    db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    const dbFactory = new DbFactory('/tmp/test-91.db')
    dbFactory.setMainDb(db)

    router = new OneDbRouter(dbFactory)
    realm = await router.getRealm(REALM)
    realm.getEngine().retainedEventWaitTimeoutMs = 500

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

    // Step 2: Create customer schema via admin API (registered on realm by OneDbRouter)
    const schemaResult: any = await api.callrpc(AdminEvent.SCHEMA_ADD, {
      label: 'customer',
      urlPattern: 'customer.*',
      schema: {
        properties: { id: 'string', name: 'string', credit: 'number' },
        primary_key: ['id']
      }
    })
    expect(schemaResult.schemaId).to.be.a('string')
    expect(schemaResult.dataTable).to.be.a('string')

    // Step 3: Register projection record (no admin RPC for this yet)
    const registry = new StorageRegistry(db, REALM, router.getMakeId())
    await registry.register({
      name: 'customer-proj',
      uriPattern: 'customer.*',
      schemaId: schemaResult.schemaId
    })

    const tableRow = await db.get(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
      [schemaResult.dataTable]
    )
    expect(tableRow).to.exist

    // Step 4: Activate via admin API — returns immediately, poll until online
    const activateResult: any = await api.callrpc(AdminEvent.KV_ACTIVATE, { name: 'customer-proj' })
    expect(activateResult.status).to.equal('refreshing')

    let projStatus = 'refreshing'
    for (let i = 0; i < 20 && projStatus === 'refreshing'; i++) {
      await sleep(10)
      const listResult: any = await api.callrpc(AdminEvent.KV_LIST, {})
      const proj = listResult.storages?.find((s: any) => s.name === 'customer-proj')
      projStatus = proj?.status ?? 'unknown'
      if (projStatus === 'failed') throw new Error(`Projection activation failed: ${proj?.lastError}`)
    }
    expect(projStatus).to.equal('online')

    const rowsAfterActivation = await db.all(`SELECT * FROM "${schemaResult.dataTable}"`)
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

    expect(events).to.have.lengthOf(1)
    expect(events[0]).to.deep.include({ id: 'id2', name: 'Bob', credit: 200 })

    const allRows = await db.all(`SELECT * FROM "${schemaResult.dataTable}"`)
    expect(allRows).to.have.lengthOf(2)
    const id2Row = allRows.find((r: any) => r.id === 'id2')
    expect(id2Row).to.exist
    expect(id2Row.name).to.equal('Bob')
    expect(id2Row.credit).to.equal(200)
  })
})
