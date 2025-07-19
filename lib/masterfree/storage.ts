import { BaseRealm } from '../realm'
import { ComplexId, makeEmpty, keyId, keyComplexId } from './makeid'
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

export class StorageTask {
  private sysRealm: BaseRealm
  private dbFactory: DbFactory
  private maxId: ComplexId
  private segmentToWrite = new Map()

  constructor (sysRealm: BaseRealm, dbFactory: DbFactory) {
    this.sysRealm = sysRealm
    this.dbFactory = dbFactory
    this.maxId = makeEmpty(new Date())

    const api = sysRealm.buildApi()

    api.subscribe(Event.BEGIN_ADVANCE_SEGMENT, (args: BODY_BEGIN_ADVANCE_SEGMENT) => {
      const boby: BODY_TRIM_ADVANCE_SEGMENT = {
        advanceSegment: args.advanceSegment, 
        advanceOwner: args.advanceOwner
      }
      api.publish(Event.TRIM_ADVANCE_SEGMENT + '.' + args.advanceOwner, boby)
    })

    api.subscribe(Event.KEEP_ADVANCE_HISTORY, (args: any) => {
      console.log("Event.KEEP_ADVANCE_HISTORY", args)
      this.lineupEvent(args)
    })

    api.subscribe(Event.ADVANCE_SEGMENT_OVER, (args: any) => {
      const advanceSegment = args[0].advanceSegment
      api.publish(Event.GENERATE_DRAFT, {advanceSegment: advanceSegment})
    })

    // api.subscribe(
    //   'eventSourceLock',
    //   (args: any, opts: any) => {
    //     if (args.pid == process.pid) {
    //       console.log('gate '+this.gateId + ": eventSource in "+this.isEventSource, args, opts)
    //     }
    //   },
    //   {retained: true}
    // )

    // api.publish(
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

  write_segment (advanceSegment: string, segmentId: ComplexId) {
    console.log("dbSaveSegment", advanceSegment, segmentId)
    let segment = this.segmentToWrite.get(advanceSegment)
    if (segment) {
      let effectId = this.dbSaveSegment(segment, segmentId)
      this.segmentToWrite.delete(advanceSegment)
//      this.pubResult(advanceSegment, segment, effectId)
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
