import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { Router } from '../lib/router'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { DbEngine } from '../lib/sqlite/dbengine'
import { BaseRealm } from '../lib/realm'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { ProduceId } from '../lib/masterfree/makeid'
import { Session } from '../lib/session'
import { WampGate } from '../lib/wamp/gate'
import { SchemaRepository } from '../lib/sqlite/schema_repository'

describe('58.schema_payload_validation', function () {
  let router: Router
  let realm: BaseRealm
  let db: sqlite.Database
  let makeId: ProduceId
  let cli: Session
  let mockSocket: any
  let wampGate: WampGate
  let ctx: any
  const realmName = 'testrealm'

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    const dbFactory = new DbFactory('/tmp/test-fox-wamp-58.db')
    dbFactory.setMainDb(db)

    makeId = new ProduceId(() => 'msg' + Date.now())
    makeId.actualizePrefix()
    
    let modKv = new SqliteKvFabric(dbFactory, makeId)
    router = new Router()
    realm = new BaseRealm(router, new DbEngine(makeId, modKv))
    await router.initRealm(realmName, realm)

    mockSocket = { 
      lastMsg: null as any,
      wampPkgWrite: function(msg: any) { this.lastMsg = msg } 
    }
    wampGate = new WampGate(router)
    cli = router.createSession()
    ctx = wampGate.createContext(cli, mockSocket)
    realm.joinSession(cli)
  })

  it('rejects publish if payload does not match schema (using property objects)', async () => {
    const engine = realm.getEngine() as DbEngine
    const repo = realm.engine.getSchemaRepository() as SchemaRepository
    
    const schema = {
      properties: {
        id: { type: 'string' },
        val: { type: 'number' }
      },
      primary_key: ['id']
    }
    
    await repo.register('test-schema-obj', 'app.topic.obj.#', schema)
    
    const id = 126
    wampGate.handle(ctx, cli, [
      16, // PUBLISH
      id,
      { acknowledge: true },
      'app.topic.obj.foo',
      [{ id: 'foo', val: 'not-a-number' }]
    ])

    await new Promise(resolve => setTimeout(resolve, 50))

    const msg = mockSocket.lastMsg
    expect(msg).to.not.be.null
    expect(msg[0]).to.equal(8) // ERROR
    expect(msg[4]).to.equal('wamp.error.invalid_argument')
    expect(msg[5][0]).to.contain('Field "val" expected type "number"')
  })

  it('rejects call if payload does not match schema', async () => {
    const engine = realm.getEngine() as DbEngine
    const repo = realm.engine.getSchemaRepository() as SchemaRepository
    
    const schema = {
      properties: {
        id: 'string'
      },
      primary_key: ['id']
    }
    
    await repo.register('call-schema', 'proc.test', schema)
    
    const id = 127
    wampGate.handle(ctx, cli, [
      48, // CALL
      id,
      {},
      'proc.test',
      [{ id: 123 }] // id should be string
    ])

    await new Promise(resolve => setTimeout(resolve, 50))

    const msg = mockSocket.lastMsg
    expect(msg).to.not.be.null
    expect(msg[0]).to.equal(8) // ERROR
    expect(msg[1]).to.equal(48) // CALL
    expect(msg[2]).to.equal(id)
    expect(msg[4]).to.equal('wamp.error.invalid_argument')
    expect(msg[5][0]).to.contain('Field "id" expected type "string"')
  })

  it('rejects publish if payload does not match schema', async () => {
    const engine = realm.getEngine() as DbEngine
    const repo = realm.engine.getSchemaRepository() as SchemaRepository
    
    const schema = {
      properties: {
        id: 'string',
        val: 'number'
      },
      primary_key: ['id']
    }
    
    await repo.register('test-schema', 'app.topic.#', schema)
    
    const id = 123
    wampGate.handle(ctx, cli, [
      16, // PUBLISH
      id,
      { acknowledge: true },
      'app.topic.foo',
      [{ id: 'foo', val: 'not-a-number' }]
    ])

    // Wait for async processing
    await new Promise(resolve => setTimeout(resolve, 50))

    const msg = mockSocket.lastMsg
    expect(msg).to.not.be.null
    expect(msg[0]).to.equal(8) // ERROR
    expect(msg[1]).to.equal(16) // PUBLISH
    expect(msg[2]).to.equal(id)
    expect(msg[4]).to.equal('wamp.error.invalid_argument')
    expect(msg[5][0]).to.contain('Field "val" expected type "number"')
  })

  it('accepts publish if payload matches schema', async () => {
    const engine = realm.getEngine() as DbEngine
    const repo = realm.engine.getSchemaRepository() as SchemaRepository
    
    const schema = {
      properties: {
        id: 'string',
        val: 'number'
      },
      primary_key: ['id']
    }
    
    await repo.register('test-schema-2', 'app.topic.ok.#', schema)
    
    const id = 124
    wampGate.handle(ctx, cli, [
      16, // PUBLISH
      id,
      { acknowledge: true },
      'app.topic.ok.foo',
      [{ id: 'foo', val: 123 }]
    ])

    await new Promise(resolve => setTimeout(resolve, 50))

    const msg = mockSocket.lastMsg
    expect(msg).to.not.be.null
    expect(msg[0]).to.equal(17) // PUBLISHED
    expect(msg[1]).to.equal(id)
  })

  it('accepts free-form publish if no schema matches', async () => {
    const id = 125
    wampGate.handle(ctx, cli, [
      16, // PUBLISH
      id,
      { acknowledge: true },
      'other.topic',
      [{ any: 'data' }]
    ])

    await new Promise(resolve => setTimeout(resolve, 50))

    const msg = mockSocket.lastMsg
    expect(msg).to.not.be.null
    expect(msg[0]).to.equal(17) // PUBLISHED
    expect(msg[1]).to.equal(id)
  })
})
