import { once } from 'node:events'
import * as net from 'net'

import * as chai from 'chai'; const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { Router } from '../lib/router'
import { FoxGate } from '../lib/hyper/gate'
import { HyperNetClient, listenHyperNetServer } from '../lib/hyper/net_transport'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { EventStorageTask, SEGMENT_COMMITTED } from '../lib/masterfree/storage'
import { Config } from '../lib/masterfree/config'
import { startKvNode, KvNodeHandle } from '../lib/masterfree/kvnode'
import { AdminEvent, Event, BODY_KEEP_ADVANCE_HISTORY, BODY_ADVANCE_SEGMENT_RESOLVED, INTRA_REALM_NAME } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'

async function freePort (): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port
      server.close(() => resolve(port))
    })
    server.on('error', reject)
  })
}

async function eventually (check: () => Promise<boolean>, what: string, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await check()) return
    if (Date.now() > deadline) throw new Error('timed out waiting for ' + what)
    await new Promise(resolve => setTimeout(resolve, 25))
  }
}

function makeConfig (entryPort: number, kvPort: number, storage: string[] = ['*:#']): Config {
  const config = new Config()
  ;(config as any).config = {
    entryNodes: { E1: { host: '127.0.0.1', port: String(entryPort) } },
    dbNodes: { KV1: { host: '127.0.0.1', port: String(kvPort), storage } }
  }
  return config
}

describe('77.kvnode_e2e', function (this: Mocha.Suite) {
  this.timeout(15000)

  describe('startup validation (6.2)', () => {
    it('6.2 rejects a NODE_ID that is not in dbNodes, before opening anything', async () => {
      const config = makeConfig(1, 2)
      let failure: Error | undefined
      try { await startKvNode({ nodeId: 'KV99', dbFile: ':memory:', config }) } catch (e) { failure = e as Error }
      expect(failure && failure.message).to.include('KV99')
      expect(failure && failure.message).to.include('not found')
    })

    it('6.2 rejects a malformed storage pattern', async () => {
      const config = makeConfig(1, 2, ['myapp.orders'])
      let failure: Error | undefined
      try { await startKvNode({ nodeId: 'KV1', dbFile: ':memory:', config }) } catch (e) { failure = e as Error }
      expect(failure && failure.message).to.include('separator')
    })
  })

  describe('entry + storage + kvnode over real sockets (6.4-6.6)', () => {
    let entryServer: net.Server
    let storageClient: HyperNetClient
    let node: KvNodeHandle
    let adminClient: HyperNetClient
    let storageDbFactory: DbFactory
    let storageApi: HyperClient
    let segmentCounter = 0

    // stands in for the ID election: buffers events on the storage node and resolves the segment
    async function commit (events: Array<{ id: string, val: string }>): Promise<void> {
      segmentCounter++
      const segment = 's' + segmentCounter
      for (let i = 0; i < events.length; i++) {
        const kah: BODY_KEEP_ADVANCE_HISTORY = {
          advanceOwner: 'e1',
          advanceId: { segment: segmentCounter, offset: i + 1 },
          shard: 0,
          realm: 'myapp',
          data: { kv: { id: events[i].id, val: events[i].val } } as any,
          uri: ['orders', events[i].id],
          opt: { retain: true },
          sid: 'session1'
        }
        await storageApi.publish(Event.keepAdvanceHistoryTopic(0), kah, { exclude_me: false })
      }
      const committed = once(storageDbFactory, SEGMENT_COMMITTED)
      const asr: BODY_ADVANCE_SEGMENT_RESOLVED = { advanceOwner: 'e1', advanceStamp: segmentCounter, segment }
      await storageApi.publish(Event.ADVANCE_SEGMENT_RESOLVED, asr, { exclude_me: false })
      await committed
    }

    beforeEach(async () => {
      segmentCounter = 0
      const entryPort = await freePort()
      const kvPort = await freePort()

      // entry node: just the sys realm behind a FOX gate
      const entryRouter = new Router()
      entryRouter.setId('E1')
      await entryRouter.getRealm(INTRA_REALM_NAME)
      entryServer = listenHyperNetServer(new FoxGate(entryRouter), { port: entryPort, host: '127.0.0.1' })
      await once(entryServer, 'listening')

      // storage node owning shard 0, attached to the entry
      const storageDb = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      storageDbFactory = new DbFactory('/tmp/fox-test-dbs/')
      storageDbFactory.setMainDb(storageDb)
      const storageRouter = new Router()
      storageRouter.setId('NDB1')
      const storageSys = await storageRouter.getRealm(INTRA_REALM_NAME)
      const storage = new EventStorageTask(storageSys, storageDbFactory, { shards: [0] }, 'NDB1')
      storageApi = storageSys.buildApi()
      storageClient = new HyperNetClient({ host: '127.0.0.1', port: entryPort })
      storageClient.onopen(async () => {
        await storageClient.login({ realm: INTRA_REALM_NAME })
        await storage.listenEntry(storageClient, 'E1')
      })
      await storageClient.connect()

      // the KV-node under test
      node = await startKvNode({ nodeId: 'KV1', dbFile: ':memory:', config: makeConfig(entryPort, kvPort) })
      await eventually(async () => node.wireSource.getActiveLinkName() === 'E1', 'the KV-node to attach to the entry')

      adminClient = new HyperNetClient({ host: '127.0.0.1', port: kvPort })
      await adminClient.connect()
      await adminClient.login({ realm: 'myapp' })
    })

    afterEach(() => {
      adminClient.close()
      node.close()
      storageClient.close()
      entryServer.close()
    })

    it('6.4 the admin gate is reachable directly on the KV-node\'s own port, bootstrapping the realm on first login', async () => {
      const list: any = await adminClient.callrpc(AdminEvent.KV_LIST, {})
      expect(list.storages).to.deep.equal([])
      const nodes: any = await adminClient.callrpc(AdminEvent.KV_NODE_LIST, {})
      expect(nodes.nodes).to.deep.equal([{ nodeId: 'KV1', host: '127.0.0.1', port: nodes.nodes[0].port, pattern: '*:#' }])
    })

    it('6.6 backfills history that predates the projection, then follows live commits', async () => {
      // published before the projection exists: only obtainable by pulling history from storage
      await commit([{ id: 'o1', val: 'one' }, { id: 'o2', val: 'two' }])

      const schemaRes: any = await adminClient.callrpc(AdminEvent.SCHEMA_ADD, {
        label: 'orders', urlPattern: 'orders.*',
        schema: { properties: { id: 'string', val: 'string' }, primary_key: ['id'], url_pattern: 'orders.*' }
      })
      await adminClient.callrpc(AdminEvent.KV_ADD, { name: 'p1', schemaId: schemaRes.schemaId })
      const activation: any = await adminClient.callrpc(AdminEvent.KV_ACTIVATE, { name: 'p1' })
      expect(activation.status).to.equal('refreshing')

      await eventually(async () => {
        const list: any = await adminClient.callrpc(AdminEvent.KV_LIST, {})
        return list.storages[0].status === 'online'
      }, 'the projection to go online')

      const rows = () => node.db.all(`SELECT id, val FROM "${schemaRes.dataTable}" ORDER BY id`)
      expect(await rows()).to.deep.equal([{ id: 'o1', val: 'one' }, { id: 'o2', val: 'two' }])

      // published after the projection is online: arrives through the wire SEGMENT_COMMITTED feed
      await commit([{ id: 'o3', val: 'three' }])
      await eventually(async () => (await rows()).length === 3, 'the live event to be projected')
      expect(await rows()).to.deep.equal([{ id: 'o1', val: 'one' }, { id: 'o2', val: 'two' }, { id: 'o3', val: 'three' }])

      const list: any = await adminClient.callrpc(AdminEvent.KV_LIST, {})
      expect(list.storages[0].currentPosition).to.equal('s2a1')
    })

    it('6.5 the KV-node advances a projection from the wire feed alone (no local storage emitter)', async () => {
      const schemaRes: any = await adminClient.callrpc(AdminEvent.SCHEMA_ADD, {
        label: 'orders', urlPattern: 'orders.*',
        schema: { properties: { id: 'string', val: 'string' }, primary_key: ['id'], url_pattern: 'orders.*' }
      })
      await adminClient.callrpc(AdminEvent.KV_ADD, { name: 'p1', schemaId: schemaRes.schemaId })
      await adminClient.callrpc(AdminEvent.KV_ACTIVATE, { name: 'p1' })
      await eventually(async () => ((await adminClient.callrpc(AdminEvent.KV_LIST, {})) as any).storages[0].status === 'online', 'online')

      await commit([{ id: 'x1', val: 'first' }])
      await eventually(async () => (await node.db.all(`SELECT * FROM "${schemaRes.dataTable}"`)).length === 1, 'projection to advance')
    })
  })
})
