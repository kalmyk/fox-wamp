import * as sqlite from 'sqlite'

import { BaseRealm } from '../realm'
import { ComplexId, makeEmpty, keyId } from './makeid'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { createStorageRegistryTables } from '../sqlite/storage_registry'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_BEGIN_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_RESOLVED, BODY_ADVANCE_SEGMENT_OVER, BODY_GENERATE_DRAFT } from './hyper.h'
import { EventEmitter } from 'stream'

export const SEGMENT_COMMITTED = 'segment-committed'  // emit CommittedSegmentEvent

export type CommittedSegmentRecord = {
  eventId: string
  realm: string
  uri: string[]
  data: any
  opt: any
  sid: string
  shard: number
}

export type CommittedSegmentEvent = BODY_ADVANCE_SEGMENT_RESOLVED & {
  events: CommittedSegmentRecord[]
}

export interface SegmentCommittedSource {
  on(event: typeof SEGMENT_COMMITTED, listener: (event: CommittedSegmentEvent) => void): any
}

export interface LocalSegmentPusher {
  pushLocalEvent(realm: string, uri: string[], data: any, opt: any, sid: string, eventId: string): void
}

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

// apply distributed network to database file
export class StorageTask extends EventEmitter implements SegmentCommittedSource, LocalSegmentPusher {
  private sysRealm: BaseRealm
  private dbFactory: DbFactory
  private maxId: ComplexId
  private bufferToWrite: Map<string, HistoryBuffer> = new Map()
  private api: HyperClient
  private realms: Map<string, string> = new Map()

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory) {
    super()
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())

    this.api = sysRealm.buildApi()

    this.api.subscribe(Event.BEGIN_ADVANCE_SEGMENT, (args: BODY_BEGIN_ADVANCE_SEGMENT) => {
      const msg: BODY_TRIM_ADVANCE_SEGMENT = {
        advanceStamp: args.advanceStamp,
        advanceOwner: args.advanceOwner
      }
      this.api.publish(Event.TRIM_ADVANCE_SEGMENT + '.' + args.advanceOwner, msg, {exclude_me: false})
      console.log("PING: BEGIN_ADVANCE_SEGMENT => TRIM_ADVANCE_SEGMENT", args.advanceStamp)
    })

    this.api.subscribe(Event.KEEP_ADVANCE_HISTORY, this.event_keep_advance_history.bind(this))

    this.api.subscribe(Event.ADVANCE_SEGMENT_OVER, (body: BODY_ADVANCE_SEGMENT_OVER) => {
      const msg: BODY_GENERATE_DRAFT = {
        advanceStamp: body.advanceStamp,
        advanceOwner: body.advanceOwner,
        shardTag: body.shardTag,
      }
      this.api.publish(Event.GENERATE_DRAFT, msg, {exclude_me: false})
    })

    this.api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (body: BODY_ADVANCE_SEGMENT_RESOLVED) => {
      this.commit_segment(body.advanceOwner, body.advanceStamp, body.segment).then((result) => {
        this.emit(SEGMENT_COMMITTED, result)
      }).catch((err) => {
        console.error("Error in commit_segment:", err)
      })
    })

    // TODO: entry, let me be your event source
    // this.api.subscribe(
    //   'eventSourceLock',
    //   (args: any, opts: any) => {
    //     if (args.pid == process.pid) {
    //       console.log('gate '+this.gateId + ": eventSource in "+this.isEventSource, args, opts)
    //     }
    //   },
    //   {retained: true}
    // )

    // this.api.publish(
    //   'eventSourceLock',
    //   { pid: process.pid },
    //   { acknowledge: true, retain: true, when: null, will: null, watch: true, exclude_me: false }
    // ).then((result) => {
    //   console.log('GATE:'+this.gateId+': use that db as event source', result)
    //   this.isEventSource = true
    // })
  }

  getMaxId (): ComplexId {
    return this.maxId
  }

  async listenEntry(client: HyperClient, gateId: string) {
    await client.pipe(this.api, Event.BEGIN_ADVANCE_SEGMENT, {exclude_me: false})
    await client.pipe(this.api, Event.KEEP_ADVANCE_HISTORY, {exclude_me: false})
    await client.pipe(this.api, Event.ADVANCE_SEGMENT_OVER, {exclude_me: false})

    // export to GATE
    await this.api.pipe(client, Event.TRIM_ADVANCE_SEGMENT + '.' + gateId)
  }

  async listenStageOne(client: HyperClient) {
    // export GENERATE_DRAFT to all sync hosts
    await this.api.pipe(client, Event.GENERATE_DRAFT, {exclude_me: false})
  }

  async listenStageTwo(client: HyperClient) {
    await client.pipe(this.api, Event.ADVANCE_SEGMENT_RESOLVED, {exclude_me: false})
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
      this.realms.set(realm, "ok")
    }
  }

  async commit_segment (advanceOwner: string, advanceStamp: number, segment: string): Promise<CommittedSegmentEvent> {
    const key = advanceOwner + ':' + advanceStamp
    let buffer = this.bufferToWrite.get(key)
    let events: CommittedSegmentRecord[] = []
    if (buffer) {
      events = await this.dbSaveSegment(buffer, segment)
      this.bufferToWrite.delete(key)
    } else {
      console.error("advanceStamp not found in segments [", key, "]")
    }
    return { advanceOwner, advanceStamp, segment, events }
  }

  async dbSaveSegment (historyBuffer: HistoryBuffer, segment: string): Promise<CommittedSegmentRecord[]> {
    const db: sqlite.Database = this.dbFactory.getMainDb()
    let result: CommittedSegmentRecord[] = []
    let offset: number = 0

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
      await db.run('COMMIT')
    } catch (err) {
      await db.run('ROLLBACK')
      throw err
    }
    return result
  }

  pushLocalEvent(realm: string, uri: string[], data: any, opt: any, sid: string, eventId: string) {
    this.emit(SEGMENT_COMMITTED, {
      advanceOwner: 'local',
      advanceStamp: 0,
      segment: eventId,
      events: [{
        eventId,
        realm,
        uri,
        data,
        opt,
        sid,
        shard: 0
      }]
    })
  }
}
