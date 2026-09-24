import * as net from 'net'
import * as sqlite from 'sqlite'
import { Config, setConfigInstance } from './config'
import { keyDate, ProduceId } from './makeid'
import { KvNodeRouter } from './kvnoderouter'
import { HyperNetEntryLink, WireSegmentCommittedSource } from './wire_segment_source'
import { WireHistoryFetchSource } from './wire_history_source'
import { DbFactory } from '../sqlite/dbfactory'
import { SqliteKvFabric } from '../sqlite/sqlitekv'
import { ProjectionListener } from '../sqlite/projection_listener'
import { listenHyperNetServer } from '../hyper/net_transport'
import { FoxGate } from '../hyper/gate'

export type KvNodeOptions = {
  nodeId: string
  dbFile: string
  config: Config
}

export type KvNodeHandle = {
  router: KvNodeRouter
  db: sqlite.Database
  wireSource: WireSegmentCommittedSource
  links: HyperNetEntryLink[]
  server: net.Server
  close (): void
}

// Starts a standalone KV-node (see openspec/changes/add-kv-node-process). Two roles run
// concurrently and independently:
//  - an inbound admin gate on this node's own dbNodes.<id>.host/port. AdminApiServer's RPCs can
//    only be reached by a direct connection: pipe() forwards pub/sub, never RPC registrations,
//    so nothing can relay them through an entry node (this mirrors bin/masterfree/sync.ts);
//  - outbound subscriptions to every configured entry node's wire Event.SEGMENT_COMMITTED
//    broadcast, which — unlike a storage node's local emitter — covers every shard.
// It takes no part in StageOne/StageTwo voting.
//
// Fails fast (rejects) on an unknown node id or a malformed storage pattern, before opening
// anything, matching how ndb.ts treats validateShardsForNode.
export async function startKvNode (options: KvNodeOptions): Promise<KvNodeHandle> {
  const { nodeId, dbFile, config } = options
  setConfigInstance(config)

  const nodeConf = config.getDbNodeById(nodeId)
  config.validateStorageForNode(nodeId)

  const dbFactory = new DbFactory('')
  const db = await dbFactory.openMainDatabase(dbFile)
  const makeId = new ProduceId(() => keyDate(new Date()))
  makeId.actualizePrefix()
  const modKv = new SqliteKvFabric(dbFactory, makeId)

  const entryNodes = config.getEntryNodes() || {}
  const links = Object.keys(entryNodes).map(entryId => {
    const entryConf = entryNodes[entryId]
    return new HyperNetEntryLink(entryId, entryConf.host, Number(entryConf.port))
  })
  const wireSource = new WireSegmentCommittedSource(links)
  const historySource = new WireHistoryFetchSource(() => wireSource.getActiveClient())
  const projectionListener = new ProjectionListener(wireSource, db, makeId, {
    historySource,
    // a projection that finished catch-up seeds the live ordering guard, so a stale live record
    // cannot regress it (add-kv-node-process design.md Decision 7)
    onProjectionOnline: (realmName, position) => wireSource.seedHighWater(realmName, position)
  })
  const router = new KvNodeRouter(nodeId, modKv, projectionListener, makeId)

  const server = listenHyperNetServer(new FoxGate(router), { port: Number(nodeConf.port) })
  for (const link of links) {
    // resolves on first connect; an unreachable entry keeps retrying in the background
    link.connect().catch(() => {})
  }

  return {
    router,
    db,
    wireSource,
    links,
    server,
    close () {
      for (const link of links) link.close()
      server.close()
    }
  }
}
