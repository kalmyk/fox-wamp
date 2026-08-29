import * as sqlite from 'sqlite'

import { BaseRealm, unSerializeData } from '../realm'
import { ComplexId, makeEmpty, keyId } from './makeid'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { withWriteLock } from '../sqlite/db_lock'
import { createStorageRegistryTables } from '../sqlite/storage_registry'
import { insertSegmentOver, updateSegmentResolved, computeUriCrc, listResolvedSegmentIdsForShard } from '../sqlite/segment_registry'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_BEGIN_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_RESOLVED, BODY_ADVANCE_SEGMENT_OVER, BODY_GENERATE_DRAFT, BODY_STORAGE_NODE_CONNECTED, HistoryFetchRequest, HistoryFetchProgress, HistoryEvent } from './hyper.h'

export { SEGMENT_COMMITTED, CommittedSegmentRecord, CommittedSegmentEvent, SegmentCommittedSource } from './segment_types'

export class HistoryBuffer {
  private content: Array<BODY_KEEP_ADVANCE_HISTORY> = []
  private shard: number

  constructor (shard: number) {
    this.shard = shard
  }

  getShard (): number {
    return this.shard
  }

  addEvent (event: BODY_KEEP_ADVANCE_HISTORY) {
    this.content.push(event)
  }

  getContent (): Array<BODY_KEEP_ADVANCE_HISTORY> {
    return this.content
  }

  count (): number {
    return this.content.length
  }
}

import { SEGMENT_COMMITTED, CommittedSegmentRecord, CommittedSegmentEvent } from './segment_types'

export type EventNodeConfig = { shards: number[] }

export class EventStorageTask {
  private sysRealm: BaseRealm
  private dbFactory: DbFactory
  private maxId: ComplexId
  private bufferToWrite: Map<string, HistoryBuffer> = new Map()
  private api: HyperClient
  private realms: Set<string> = new Set()
  private ownedTopics: string[] = []
  private nodeId: string
  private shards: number[]

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory, shardConfig: EventNodeConfig, nodeId: string) {
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())
    this.nodeId = nodeId
    this.shards = shardConfig.shards

    this.api = sysRealm.buildApi()

    for (const shard of shardConfig.shards) {
      const beginTopic = Event.beginAdvanceSegmentTopic(shard)
      const historyTopic = Event.keepAdvanceHistoryTopic(shard)
      this.ownedTopics.push(historyTopic)
      this.api.subscribe(beginTopic, (args: BODY_BEGIN_ADVANCE_SEGMENT) => {
        const msg: BODY_TRIM_ADVANCE_SEGMENT = {
          advanceStamp: args.advanceStamp,
          advanceOwner: args.advanceOwner
        }
        this.api.publish(Event.TRIM_ADVANCE_SEGMENT + '.' + args.advanceOwner, msg, {exclude_me: false})
        console.log("PING: BEGIN_ADVANCE_SEGMENT => TRIM_ADVANCE_SEGMENT", args.advanceStamp)
      })
      this.api.subscribe(historyTopic, (event: BODY_KEEP_ADVANCE_HISTORY) => {
        this.event_keep_advance_history(event)
      })
      // Registered locally too (in addition to per-entry registration in listenEntry) so the
      // RPC is callable by any client sharing this task's own realm — e.g. same-realm tests,
      // or same-node local callers — without requiring a listenEntry() handshake first.
      this.api.register(Event.historyFetchTopic(shard), (req: HistoryFetchRequest, opt: any) => {
        return this.handleHistoryFetch(shard, req, opt)
      })
    }
    console.log('EventStorageTask: subscribed to shard topics:', this.ownedTopics.join(', '))

    this.api.subscribe(Event.ADVANCE_SEGMENT_OVER, (body: BODY_ADVANCE_SEGMENT_OVER) => {
      const msg: BODY_GENERATE_DRAFT = {
        advanceStamp: body.advanceStamp,
        advanceOwner: body.advanceOwner,
        shardTag: body.shardTag,
      }
      this.api.publish(Event.GENERATE_DRAFT, msg, {exclude_me: false})

      const buffer = this.bufferToWrite.get(body.advanceOwner + ':' + body.advanceStamp)
      if (buffer) {
        const db = this.dbFactory.getMainDb()
        const realms = new Set(buffer.getContent().map(e => e.realm))
        for (const realm of realms) {
          this.ensureRealm(realm)
            .then(() => withWriteLock(db, () => insertSegmentOver(db, realm, body.advanceOwner, body.advanceStamp, body.shardTag), { label: 'storage.insertSegmentOver' }))
            .catch(err => console.error('insertSegmentOver error:', err))
        }
      }
    })

    this.api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (body: BODY_ADVANCE_SEGMENT_RESOLVED) => {
      this.commit_segment(body.advanceOwner, body.advanceStamp, body.segment).then((result) => {
        this.dbFactory.emit(SEGMENT_COMMITTED, result)
        // Live-tail delivery (see openspec/changes/net-subscription D7/D8): re-broadcast the
        // same commit, over the wire this time, to every connected entry so
        // NetEngineMill.dispatchLiveEvents() can feed BaseRealm.disperseToSubs() for live
        // subscribers cluster-wide, not just the entry that originally accepted the publish.
        // A no-data commit (this node doesn't own the shard's buffered data) produces an empty
        // `events` array and is skipped — nothing to dispatch.
        if (result.events.length > 0) {
          this.api.publish(Event.SEGMENT_COMMITTED, result, { exclude_me: false })
        }
      }).catch((err) => {
        console.error("Error in commit_segment:", err)
      })
    })
  }

  getMaxId (): ComplexId {
    return this.maxId
  }

  async listenEntry(client: HyperClient, gateId: string) {
    await client.pipe(this.api, Event.BEGIN_ADVANCE_SEGMENT + '.*', {exclude_me: false})
    for (const topic of this.ownedTopics) {
      await client.pipe(this.api, topic, {exclude_me: false})
    }
    await client.pipe(this.api, Event.ADVANCE_SEGMENT_OVER, {exclude_me: false})

    // export to GATE
    await this.api.pipe(client, Event.TRIM_ADVANCE_SEGMENT + '.' + gateId)

    // ADVANCE_SEGMENT_RESOLVED is produced locally by this node's colocated StageTwoTask
    // (same sysRealm) once quorum is reached — it never otherwise reaches the entry node.
    // Without this pipe, NetEngineMill.advance_segment_resolved() on entry never fires, so
    // acknowledged publishes (WAMP PUBLISHED) never complete, even though the underlying
    // events are still durably committed to this node's sqlite db. Every storage node pipes
    // its own copy to every entry it's connected to; entry-side findSegment/deleteSegment
    // makes redundant deliveries for an already-resolved segment a no-op.
    await this.api.pipe(client, Event.ADVANCE_SEGMENT_RESOLVED, {exclude_me: false})

    // Live-tail: pipe this same SEGMENT_COMMITTED broadcast to this entry too, independent of
    // whether this entry originally accepted the publish — a live subscriber may be on any
    // entry. See openspec/changes/net-subscription D7/D8.
    await this.api.pipe(client, Event.SEGMENT_COMMITTED, {exclude_me: false})

    // announce this storage node's connection to the entry
    await this.api.pipe(client, Event.STORAGE_NODE_CONNECTED)

    await this.announceToEntry(client)
  }

  // pipe() only forwards pub/sub events, not RPC registrations — an entry's local
  // sysApi.callrpc(...) can only ever reach a registrant that lives on the entry's own
  // realm object, which for a genuinely remote storage node means registering through the
  // session it holds into that realm (`client`), not through `this.api` (storage's own
  // separate local realm). So on top of the STORAGE_NODE_CONNECTED pipe set up in
  // listenEntry, we also publish the announcement and register the per-shard RPC directly.
  async announceToEntry (client: HyperClient) {
    const announcement: BODY_STORAGE_NODE_CONNECTED = { nodeId: this.nodeId }
    await this.api.publish(Event.STORAGE_NODE_CONNECTED, announcement, { exclude_me: false })

    for (const shard of this.shards) {
      await client.register(Event.historyFetchTopic(shard), (req: HistoryFetchRequest, opt: any) => {
        return this.handleHistoryFetch(shard, req, opt)
      })
    }
  }

  async listenStageOne(client: HyperClient) {
    // export GENERATE_DRAFT to all sync hosts
    await this.api.pipe(client, Event.GENERATE_DRAFT, {exclude_me: false})
  }

  getHystoryBuffer(segment: string, shard: number): HistoryBuffer {
    let buffer = this.bufferToWrite.get(segment)
    if (!buffer) {
      buffer = new HistoryBuffer(shard)
      this.bufferToWrite.set(segment, buffer)
    }
    return buffer
  }

  async event_keep_advance_history (event: BODY_KEEP_ADVANCE_HISTORY) {
    let buffer = this.getHystoryBuffer(event.advanceOwner + ':' + event.advanceId.segment, event.shard)
    buffer.addEvent(event)
    if (buffer.count() !== event.advanceId.offset) {
      console.error('serment position is not equal', buffer.count(), event.advanceId.offset)
    }
    await this.ensureRealm(event.realm)
  }

  async ensureRealm (realm: string) {
    if (!this.realms.has(realm)) {
      await History.createHistoryTables(this.dbFactory.getMainDb(), realm)
      await createStorageRegistryTables(this.dbFactory.getMainDb(), realm)
      this.realms.add(realm)
    }
  }

  async commit_segment (advanceOwner: string, advanceStamp: number, segment: string): Promise<CommittedSegmentEvent> {
    const key = advanceOwner + ':' + advanceStamp
    let buffer = this.bufferToWrite.get(key)
    let events: CommittedSegmentRecord[] = []
    if (buffer) {
      const db = this.dbFactory.getMainDb()
      events = await withWriteLock(db, () => this.dbSaveSegment(buffer!, segment, advanceOwner, advanceStamp), { label: 'storage.dbSaveSegment' })
      this.bufferToWrite.delete(key)
    } else {
      console.error("advanceStamp not found in segments [", key, "]")
    }
    return { advanceOwner, advanceStamp, segment, events }
  }

  async dbSaveSegment (historyBuffer: HistoryBuffer, segment: string, advanceOwner: string, advanceStamp: number): Promise<CommittedSegmentRecord[]> {
    const db: sqlite.Database = this.dbFactory.getMainDb()
    let result: CommittedSegmentRecord[] = []
    let offset: number = 0

    // Group events by realm for per-realm segment registry update
    const realmEvents = new Map<string, BODY_KEEP_ADVANCE_HISTORY[]>()
    for (const row of historyBuffer.getContent()) {
      const group = realmEvents.get(row.realm) || []
      group.push(row)
      realmEvents.set(row.realm, group)
    }

    await db.run('BEGIN TRANSACTION')
    try {
      for (let row of historyBuffer.getContent()) {
        await this.ensureRealm(row.realm)
        let eventId: string = segment + keyId(++offset)
        await History.saveEventHistory(db, row.realm, eventId, historyBuffer.getShard(), row.uri, row.data, row.opt)
        result.push({
          eventId,
          realm: row.realm,
          uri: row.uri,
          data: row.data,
          opt: row.opt,
          sid: row.sid,
          shard: historyBuffer.getShard()
        })
      }
      for (const [realm, events] of realmEvents) {
        await updateSegmentResolved(db, realm, advanceOwner, advanceStamp, historyBuffer.getShard(), segment, events.length, computeUriCrc(events))
      }
      await db.run('COMMIT')
    } catch (err) {
      await db.run('ROLLBACK')
      throw err
    }
    return result
  }

  async handleHistoryFetch (shard: number, req: HistoryFetchRequest, opt: any): Promise<{ done: true }> {
    if (!this.realms.has(req.realm)) {
      return { done: true }
    }
    const db = this.dbFactory.getMainDb()
    const segmentIds = await listResolvedSegmentIdsForShard(db, req.realm, shard)

    let segIdx = 0
    let currentSegmentId: string | null = segIdx < segmentIds.length ? segmentIds[segIdx] : null
    let batch: HistoryEvent[] = []
    let lastEventId = ''

    const flush = () => {
      if (batch.length > 0) {
        const progress: HistoryFetchProgress = { events: batch, lastEventId }
        opt.progress(progress)
        batch = []
      }
    }

    await History.getEventHistory(
      db,
      req.realm,
      { fromId: req.afterEventId ?? undefined },
      async (row: any) => {
        if (row.shard !== shard) {
          return
        }
        while (currentSegmentId !== null && !row.id.startsWith(currentSegmentId)) {
          flush()
          segIdx++
          currentSegmentId = segIdx < segmentIds.length ? segmentIds[segIdx] : null
        }
        batch.push({
          eventId: row.id,
          shardTag: row.shard,
          uri: row.uri,
          data: unSerializeData(row.body),
          opt: row.opt
        })
        lastEventId = row.id
      }
    )
    flush()
    return { done: true }
  }
}
