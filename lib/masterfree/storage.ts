import { BaseRealm } from '../realm'
import { ComplexId, mergeMin, makeEmpty, keyId, keyComplexId } from './makeid'
import { QuorumEdge } from './quorum_edge'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_BEGIN_ADVANCE_SEGMENT } from './hyper.h'

export class HistorySegment {
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

export type PublishResult = (advanceSegment: string, segment: HistorySegment, effectId: string[]) => void

export class SessionEntryHistory {
  private gateId: string
  private storage: StorageTask
  private isEventSource: boolean = false
  private client: HyperClient

    // this.wampSession = wampSession
  private curAdvanceSegment: string | undefined = undefined
  private pubResult: PublishResult

  private segmentToWrite = new Map()

  constructor (storage: StorageTask, gateId: string, client: HyperClient, pubResult: PublishResult) {
    this.pubResult = pubResult
    this.storage = storage
    this.gateId = gateId
    this.client = client

    this.client.afterOpen(() => {
      this.client.subscribe(Event.BEGIN_ADVANCE_SEGMENT, (args: BODY_BEGIN_ADVANCE_SEGMENT) => {
        const boby: BODY_TRIM_ADVANCE_SEGMENT = {advanceSegment: args.advanceSegment, advanceOwner: args.advanceOwner}
        this.client.publish(Event.TRIM_ADVANCE_SEGMENT + '.' + args.advanceOwner, boby)
      })

      this.client.subscribe(Event.KEEP_ADVANCE_HISTORY, (args: any) => {
        console.log("Event.KEEP_ADVANCE_HISTORY", args)
        this.lineupEvent(args)
      })

      this.client.subscribe(Event.ADVANCE_SEGMENT_OVER, (args: any) => {
        const advanceSegment = args[0].advanceSegment
        client.publish(Event.GENERATE_SEGMENT, {advanceSegment: advanceSegment})
      })

      this.client.subscribe('eventSourceLock', (args: any, opts: any) => {
        if (args.pid == process.pid) {
          console.log('gate '+this.gateId + ": eventSource in "+this.isEventSource, args, opts)
        }
      }, {retained: true})

      this.client.publish(
        'eventSourceLock',
        { pid: process.pid },
        { acknowledge: true, retain: true, when: null, will: null, watch: true, exclude_me: false }
      ).then((result) => {
        console.log('GATE:'+this.gateId+': use that db as event source', result)
        this.isEventSource = true
      })
      
    })
  }

  lineupEvent (event: BODY_KEEP_ADVANCE_HISTORY) {
    let segment = this.segmentToWrite.get(event.advanceId.segment)
    if (!segment) {
      segment = new HistorySegment()
      this.segmentToWrite.set(event.advanceId.segment, segment)
    }
    segment.addEvent(event)
    if (segment.count() !== event.advanceId.offset) {
      console.error('serment position is not equal', segment.count(), event.advanceId.offset)
    }
  }

  publishSegment (segment: HistorySegment) {
    if (this.isEventSource) {
      for (const event of segment.getContent()) {
        console.log('publishSegment-dispatchEvent', event)
        this.client.publish('dispatchEvent', {
          realm: event.realm,
          data: event.data,
          uri: event.uri,
          opt: event.opt,
          sid: event.sid,
          qid: event.qid
        })
      }
    }
  }

  commit_segment (advanceSegment: string, segmentId: ComplexId): boolean {
    // check is advanceSegment of mine session
    if (this.curAdvanceSegment === advanceSegment) {
      console.log("dbSaveSegment", advanceSegment, segmentId)
      let segment = this.segmentToWrite.get(advanceSegment)
      if (segment) {
        this.segmentToWrite.delete(advanceSegment)
        let effectId = this.storage.dbSaveSegment(segment, segmentId)
        this.pubResult(advanceSegment, segment, effectId)
      } else {
        console.error("advanceSegment not found in segments [", advanceSegment, "]")
      }
      this.curAdvanceSegment = undefined
    }
    return false
  }
}

export class StorageTask {
  private sysRealm: BaseRealm
  private dbFactory: DbFactory
  private maxId: ComplexId
  private readyQuorum: QuorumEdge<string, string, any>
  private gateMass: Map<string,SessionEntryHistory> = new Map()

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory) {
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())

    this.readyQuorum = new QuorumEdge(
      (advanceSegment, segmentId) => {
        for (let gg of this.gateMass.values()) {
          gg.commit_segment(advanceSegment, segmentId)
        }
      },
      mergeMin
    )
  }

  getMaxId (): ComplexId {
    return this.maxId
  }

  // todo: wait for promise in saveEventHistory
  dbSaveSegment (segment: HistorySegment, segmentId: ComplexId): string[] {
    let result = []
    const keySegment: string = keyComplexId(segmentId)
    let offset: number = 0

    for (let row of segment.getContent()) {
      let eventId: string = keySegment + keyId(++offset)
      History.saveEventHistory(this.dbFactory.getMainDb(), row.realm, eventId, row.uri, row.data, row.opt)
      result.push(eventId) // keep event position in result array
    }
    return result
  }
}
