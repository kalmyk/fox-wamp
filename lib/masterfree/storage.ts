import { BaseRealm } from '../realm'
import { ComplexId, mergeMin, makeEmpty, keyId, keyComplexId } from './makeid'
import { QuorumEdge } from './quorum_edge'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { AdvanceHistoryEvent } from './netengine.h'

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
  private stackAdvanceSegment: string[] = []
  private curAdvanceSegment: string | undefined = undefined
  private pubResult: PublishResult

  private segmentToWrite = new Map()

  constructor (storage: StorageTask, gateId: string, client: HyperClient, pubResult: PublishResult) {
    this.pubResult = pubResult
    this.storage = storage
    this.gateId = gateId
    this.client = client

    this.client.afterOpen(() => {
      this.client.subscribe('begin-advance-segment', (args: any, opts: any) => {
        const advanceSegment = args.advanceSegment
        this.client.publish('trim-advance-segment', [{advanceSegment: advanceSegment}])
      })

      this.client.subscribe('keep-advance-history', (args: any, opts: any) => {
        console.log("keep-advance-history", args, opts)
        this.lineupEvent(args)
      })

      this.client.subscribe('advance-segment-over', (args: any, opts: any) => {
        const advanceSegment = args[0].advanceSegment
        this.queueSync(advanceSegment)
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

  lineupEvent (event: AdvanceHistoryEvent) {
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

  checkLine () {
    if (this.curAdvanceSegment) {
      return false
    }
    this.curAdvanceSegment = this.stackAdvanceSegment.shift()
    if (this.curAdvanceSegment) {
      this.storage.sendToMakeSegment(this.curAdvanceSegment)
      return true
    }
    return false
  }

  queueSync (advanceSegment: string): boolean {
    this.stackAdvanceSegment.push(advanceSegment)
    return this.checkLine()
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

  commitSegment (advanceSegment: string, segmentId: ComplexId): boolean {
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
      return this.checkLine()
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
  private syncMass: Map<string,HyperClient> = new Map()

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory) {
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())

    this.readyQuorum = new QuorumEdge(
      (advanceSegment, segmentId) => {
        for (let gg of this.gateMass.values()) {
          gg.commitSegment(advanceSegment, segmentId)
        }
      },
      mergeMin
    )
  }

  getMaxId (): ComplexId {
    return this.maxId
  }

  sendToMakeSegment (advanceSegment: string) {
    console.log('sendToMakeSegment on SYNC advanceSegment[', advanceSegment, '] to count:', this.syncMass.size)
    for (let [,ss] of this.syncMass) {
      ss.publish('makeSegmentId', [], {advanceSegment, step: 2})
    }
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
