import * as sqlite from 'sqlite'

import { BaseRealm } from '../realm'
import { ComplexId, makeEmpty, keyId, keyComplexId } from './makeid'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_BEGIN_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_RESOLVED, BODY_ADVANCE_SEGMENT_OVER, BODY_GENERATE_DRAFT } from './hyper.h'

export class HistoryBuffer {
  private content: Array<any> = []

  addEvent (event: any) {
    this.content.push(event)
  }

  getContent (): Array<any> {
    return this.content
  }

  count (): number {
    return this.content.length
  }
}

export class StorageTask {
  private sysRealm: BaseRealm
  private dbFactory: DbFactory
  private maxId: ComplexId
  private bufferToWrite: Map<string, HistoryBuffer> = new Map()
  private api: HyperClient
  private realms: Map<string, string> = new Map()

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory) {
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())

    this.api = sysRealm.buildApi()

    this.api.subscribe(Event.BEGIN_ADVANCE_SEGMENT, (args: BODY_BEGIN_ADVANCE_SEGMENT) => {
      const msg: BODY_TRIM_ADVANCE_SEGMENT = {
        advanceSegment: args.advanceSegment,
        advanceOwner: args.advanceOwner
      }
      this.api.publish(Event.TRIM_ADVANCE_SEGMENT + '.' + args.advanceOwner, msg, {exclude_me: false})
      console.log("PING: BEGIN_ADVANCE_SEGMENT => TRIM_ADVANCE_SEGMENT", args.advanceSegment)
    })

    this.api.subscribe(Event.KEEP_ADVANCE_HISTORY, this.event_keep_advance_history.bind(this))

    this.api.subscribe(Event.ADVANCE_SEGMENT_OVER, (body: BODY_ADVANCE_SEGMENT_OVER) => {
      const msg: BODY_GENERATE_DRAFT = {
        advanceSegment: body.advanceSegment,
        advanceOwner: body.advanceOwner
      }
      this.api.publish(Event.GENERATE_DRAFT, msg, {exclude_me: false})
    })

    this.api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (body: BODY_ADVANCE_SEGMENT_RESOLVED) => {
      console.log("Event.ADVANCE_SEGMENT_RESOLVED", body)
      this.commit_segment(body.advanceSegment, body.segment)
    })

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

    // await client.callrpc('registerStorage', {nodeId: this.sysRealm.getId()})
  }

  async listenStageOne(client: HyperClient) {
    // export GENERATE_DRAFT to all sync hosts
    await this.api.pipe(client, Event.GENERATE_DRAFT, {exclude_me: false})
  }

  async listenStageTwo(client: HyperClient) {
    await client.pipe(this.api, Event.ADVANCE_SEGMENT_RESOLVED, {exclude_me: false})
  }

  async event_keep_advance_history (event: BODY_KEEP_ADVANCE_HISTORY) {
    let buffer = this.bufferToWrite.get(event.advanceId.segment)
    if (!buffer) {
      buffer = new HistoryBuffer()
      this.bufferToWrite.set(event.advanceId.segment, buffer)
    }
    buffer.addEvent(event)
    if (buffer.count() !== event.advanceId.offset) {
      console.error('serment position is not equal', buffer.count(), event.advanceId.offset)
    }
    if (this.realms.get(event.realm) === undefined) {
      this.realms.set(event.realm, event.realm)
      await History.createHistoryTables(this.dbFactory.getMainDb(), event.realm)
    }
  }

  commit_segment (advanceSegment: string, segment: string) {
    let buffer = this.bufferToWrite.get(advanceSegment)
    if (buffer) {
      let effectId = this.dbSaveSegment(buffer, segment)
      this.bufferToWrite.delete(advanceSegment)
//      this.pubResult(advanceSegment, buffer, effectId)
    } else {
      console.error("advanceSegment not found in segments [", advanceSegment, "]")
    }
  }

  // pubResult (advanceSegment: string, segment: HistorySegment, effectId: string[]) {
  //       const readyEvent = []
  //       const heapEvent = []
  //       for (let i = 0; i<segment.content.length; i++) {
  //         const event = segment.content[i]
  //         event.qid = effectId[i]
  //         if (event.opt.trace) {
  //           heapEvent.push(event)
  //         } else {
  //           readyEvent.push(event)
  //         }
  //       }
  //       // TODO: publish event to all gates publishSegment(segment)
  //       session.publish(Event.ADVANCE_SEGMENT_RESOLVED + '.' + gateId, [], {advanceSegment, pkg: readyEvent})

  //       modKv.applySegment(heapEvent, (kind, outEvent) => {
  //         session.publish('dispatchEvent', [], outEvent)
  //       }).then(() => {
  //         // session.publish('final-segment', [], {advanceSegment})
  //       })
  // }

  // todo: wait for promise in saveEventHistory
  dbSaveSegment (historyBuffer: HistoryBuffer, segment: string): string[] {
    const db: sqlite.Database = this.dbFactory.getMainDb()
    let result = []
    let offset: number = 0

    for (let row of historyBuffer.getContent()) {
      let eventId: string = segment + keyId(++offset)
      History.saveEventHistory(db, row.realm, eventId, row.uri, row.data, row.opt)
      result.push(eventId) // keep event position in result array
    }
    return result
  }
}
