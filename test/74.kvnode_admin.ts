import * as chai from 'chai'; const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { DbFactory } from '../lib/sqlite/dbfactory'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { ProjectionListener } from '../lib/sqlite/projection_listener'
import { StorageRegistry } from '../lib/sqlite/storage_registry'
import { KvNodeRouter } from '../lib/masterfree/kvnoderouter'
import { OneDbRouter } from '../lib/mono/onedbrouter'
import { Config, setConfigInstance } from '../lib/masterfree/config'
import { AdminEvent } from '../lib/masterfree/hyper.h'
import { keyDate, ProduceId } from '../lib/masterfree/makeid'
import { HyperClient } from '../lib/hyper/client'
import { MemServer } from '../lib/hyper/mem_transport'
import { FoxGate } from '../lib/hyper/gate'
import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'

const SCHEMA = (urlPattern: string) => ({ properties: { id: 'string', name: 'string' }, primary_key: ['id'], url_pattern: urlPattern })

async function expectRejection (promise: Promise<any>, text: string): Promise<void> {
  try {
    await promise
  } catch (e: any) {
    const shown = String(e && (e.message || e.code || JSON.stringify(e)))
    expect(shown).to.include(text)
    return
  }
  throw new Error('expected the call to be rejected with: ' + text)
}

function setConfig (dbNodes: any): void {
  const config = new Config()
  ;(config as any).config = { dbNodes }
  setConfigInstance(config)
}

// Calls go through FoxGate (the path a real admin client takes). The in-process client returned by
// realm.buildApi() cannot report a callee error back to its caller, so rejection cases would hang.
function remoteApi (router: Router, realm: BaseRealm): HyperClient {
  return new MemServer(new FoxGate(router)).createClient(realm)
}

describe('74.kvnode_admin', function () {
  let db: sqlite.Database
  let dbFactory: DbFactory
  let makeId: ProduceId
  let router: KvNodeRouter

  async function adminApi (realmName: string, nodeId: string): Promise<HyperClient> {
    router = new KvNodeRouter(nodeId, new SqliteKvFabric(dbFactory, makeId), new ProjectionListener(dbFactory, db, makeId), makeId)
    const realm = await router.getRealm(realmName)
    return remoteApi(router, realm)
  }

  beforeEach(async () => {
    db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    await db.run('PRAGMA foreign_keys = ON;')
    dbFactory = new DbFactory('/tmp/fox-test-dbs/')
    dbFactory.setMainDb(db)
    makeId = new ProduceId(() => keyDate(new Date()))
    makeId.actualizePrefix()
  })

  describe('registration-time node ownership gate', () => {
    beforeEach(() => {
      setConfig({ KV1: { host: '127.0.0.1', port: '1765', storage: ['myapp:orders.#'] } })
    })

    it('4.1 SCHEMA_ADD is accepted for a covered realm and url pattern', async () => {
      const api = await adminApi('myapp', 'KV1')
      const res: any = await api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') })
      expect(res.schemaId).to.be.a('string')
    })

    it('4.1 SCHEMA_ADD is rejected for an uncovered url pattern', async () => {
      const api = await adminApi('myapp', 'KV1')
      await expectRejection(
        api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'users', urlPattern: 'users.*', schema: SCHEMA('users.*') }),
        'not covered')
    })

    it('4.1 SCHEMA_ADD is rejected for an uncovered realm', async () => {
      const api = await adminApi('otherapp', 'KV1')
      await expectRejection(
        api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') }),
        'not covered')
    })

    it('4.1 KV_ADD is rejected when the schema pattern is not covered, and accepted when it is', async () => {
      const api = await adminApi('myapp', 'KV1')
      // register schemas straight into the repository so the gate is not what creates them
      const repo: any = router.findRealm('myapp')!.getEngine().getSchemaRepository()
      const uncovered = await repo.register('users', 'users.*', SCHEMA('users.*'))
      const covered = await repo.register('orders', 'orders.*', SCHEMA('orders.*'))

      await expectRejection(api.callrpc(AdminEvent.KV_ADD, { name: 'p-users', schemaId: uncovered.schemaId }), 'not covered')
      const ok: any = await api.callrpc(AdminEvent.KV_ADD, { name: 'p-orders', schemaId: covered.schemaId })
      expect(ok.name).to.equal('p-orders')
    })
  })

  describe('wildcard first-registration precedence', () => {
    beforeEach(() => {
      setConfig({
        KV1: { host: '10.0.0.1', port: '1765', storage: ['myapp:#'] },
        KV2: { host: '10.0.0.2', port: '1766', storage: ['*:#'] }
      })
    })

    it('4.2 a wildcard-only node rejects a first SCHEMA_ADD when another node declares the realm exactly', async () => {
      const api = await adminApi('myapp', 'KV2')
      await expectRejection(
        api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') }),
        'must target KV-node KV1 (10.0.0.1:1765)')
    })

    it('4.2 a wildcard-only node rejects a first KV_ADD when another node declares the realm exactly', async () => {
      const api = await adminApi('myapp', 'KV2')
      const repo: any = router.findRealm('myapp')!.getEngine().getSchemaRepository()
      const schema = await repo.register('orders', 'orders.*', SCHEMA('orders.*'))
      await expectRejection(api.callrpc(AdminEvent.KV_ADD, { name: 'p', schemaId: schema.schemaId }), 'must target KV-node KV1')
    })

    it('4.2 the exact-realm node itself accepts the first registration', async () => {
      const api = await adminApi('myapp', 'KV1')
      const res: any = await api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') })
      expect(res.schemaId).to.be.a('string')
    })

    it('4.2 a wildcard-only node accepts a first registration when no node declares the realm exactly', async () => {
      const api = await adminApi('otherapp', 'KV2')
      const res: any = await api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') })
      expect(res.schemaId).to.be.a('string')
    })

    it('4.2 the check is skipped once the realm already has a registration on this node', async () => {
      const api = await adminApi('myapp', 'KV2')
      const repo: any = router.findRealm('myapp')!.getEngine().getSchemaRepository()
      await repo.register('first', 'first.*', SCHEMA('first.*'))
      const res: any = await api.callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') })
      expect(res.schemaId).to.be.a('string')
    })

    it('4.2 KV_ADD and SCHEMA_ADD check their own registry: a registered schema does not make KV_ADD "not first"', async () => {
      const api = await adminApi('myapp', 'KV2')
      const repo: any = router.findRealm('myapp')!.getEngine().getSchemaRepository()
      const schema = await repo.register('orders', 'orders.*', SCHEMA('orders.*'))
      // the realm has a schema but no KV projection yet: still a first KV_ADD
      await expectRejection(api.callrpc(AdminEvent.KV_ADD, { name: 'p', schemaId: schema.schemaId }), 'must target KV-node KV1')
      // once a projection exists on this node, further KV_ADDs skip the precedence check
      const registry = new StorageRegistry(db, 'myapp', makeId)
      await registry.register({ name: 'existing', uriPattern: 'orders.*', schemaId: schema.schemaId })
      const ok: any = await api.callrpc(AdminEvent.KV_ADD, { name: 'p2', schemaId: schema.schemaId })
      expect(ok.name).to.equal('p2')
    })
  })

  describe('single-process mode (no dbNodes concept)', () => {
    it('4.3 AdminApiServer built without a node id skips both gates', async () => {
      setConfig({ KV1: { host: '10.0.0.1', port: '1765', storage: ['nothing:matches'] } })
      const oneDb = new OneDbRouter(dbFactory)
      const realm = await oneDb.getRealm('myapp')
      const res: any = await remoteApi(oneDb, realm).callrpc(AdminEvent.SCHEMA_ADD, { label: 'orders', urlPattern: 'orders.*', schema: SCHEMA('orders.*') })
      expect(res.schemaId).to.be.a('string')
    })
  })

  describe('KV_NODE_LIST', () => {
    it('4.4 returns every dbNodes entry flattened to one row per storage pattern', async () => {
      setConfig({
        KV1: { host: '10.0.0.1', port: '1765', storage: ['myapp:orders.#', 'myapp:users.*'] },
        KV2: { host: '10.0.0.2', port: '1766', storage: ['*:#'] }
      })
      const api = await adminApi('myapp', 'KV2')
      const res: any = await api.callrpc(AdminEvent.KV_NODE_LIST, {})
      expect(res.nodes).to.deep.equal([
        { nodeId: 'KV1', host: '10.0.0.1', port: '1765', pattern: 'myapp:orders.#' },
        { nodeId: 'KV1', host: '10.0.0.1', port: '1765', pattern: 'myapp:users.*' },
        { nodeId: 'KV2', host: '10.0.0.2', port: '1766', pattern: '*:#' }
      ])
    })

    it('4.4 returns an empty list when dbNodes is not configured', async () => {
      setConfig(undefined)
      const api = await adminApi('myapp', 'KV1')
      const res: any = await api.callrpc(AdminEvent.KV_NODE_LIST, {})
      expect(res.nodes).to.deep.equal([])
    })
  })

  describe('KvNodeRouter realm bootstrap', () => {
    beforeEach(() => {
      setConfig({ KV1: { host: '127.0.0.1', port: '1765', storage: ['*:#'] } })
    })

    it('5.1 the first login into a new realm lazily creates its admin surface', async () => {
      const kvRouter = new KvNodeRouter('KV1', new SqliteKvFabric(dbFactory, makeId), new ProjectionListener(dbFactory, db, makeId), makeId)
      expect(kvRouter.findRealm('brandnew')).to.equal(undefined)
      const realm = await kvRouter.getRealm('brandnew')
      const res: any = await remoteApi(kvRouter, realm).callrpc(AdminEvent.KV_LIST, {})
      expect(res.storages).to.deep.equal([])
    })

    it('5.1 a second login reuses the bootstrapped realm instead of rebuilding it', async () => {
      const kvRouter = new KvNodeRouter('KV1', new SqliteKvFabric(dbFactory, makeId), new ProjectionListener(dbFactory, db, makeId), makeId)
      const first = await kvRouter.getRealm('brandnew')
      const second = await kvRouter.getRealm('brandnew')
      expect(second).to.equal(first)
    })

    it('5.2 every realm\'s AdminApiServer shares the router\'s single ProjectionListener', async () => {
      const listener = new ProjectionListener(dbFactory, db, makeId)
      const kvRouter = new KvNodeRouter('KV1', new SqliteKvFabric(dbFactory, makeId), listener, makeId)
      await kvRouter.getRealm('realm_a')
      await kvRouter.getRealm('realm_b')
      // each realm's KV_ACTIVATE goes through the shared listener: activating a projection in
      // each realm must hit the same instance (spied via startActivation)
      const seen: string[] = []
      const original = listener.startActivation.bind(listener)
      ;(listener as any).startActivation = (realmName: string, name: string) => { seen.push(realmName); return original(realmName, name) }

      for (const realmName of ['realm_a', 'realm_b']) {
        const repo: any = kvRouter.findRealm(realmName)!.getEngine().getSchemaRepository()
        const schema = await repo.register('s', 's.*', SCHEMA('s.*'))
        await new StorageRegistry(db, realmName, makeId).register({ name: 'p', uriPattern: 's.*', schemaId: schema.schemaId })
        await remoteApi(kvRouter, kvRouter.findRealm(realmName)!).callrpc(AdminEvent.KV_ACTIVATE, { name: 'p' })
      }
      expect(seen).to.deep.equal(['realm_a', 'realm_b'])
      expect(kvRouter.getProjectionListener()).to.equal(listener)
    })
  })
})
