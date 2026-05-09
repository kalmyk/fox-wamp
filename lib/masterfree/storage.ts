import * as sqlite from 'sqlite'

import { BaseRealm } from '../realm'
import { ComplexId, makeEmpty, keyId } from './makeid'
import { HyperClient } from '../hyper/client'
import * as History from '../sqlite/history'
import { DbFactory } from '../sqlite/dbfactory'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_BEGIN_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_RESOLVED, BODY_ADVANCE_SEGMENT_OVER, BODY_GENERATE_DRAFT, BODY_INIT_DB, BODY_INIT_DB_ACCEPTED } from './hyper.h'
import { EventEmitter } from 'stream'

export const COMMIT_COMPLETED = 'commit-completed'  // emit BODY_ADVANCE_SEGMENT_RESOLVED

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

export class StorageTask extends EventEmitter {
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
        advanceOwner: body.advanceOwner,
        tag: body.tag,
      }
      this.api.publish(Event.GENERATE_DRAFT, msg, {exclude_me: false})
    })

    this.api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (body: BODY_ADVANCE_SEGMENT_RESOLVED) => {
      this.commit_segment(body.advanceSegment, body.segment).then((result) => {
        this.emit(COMMIT_COMPLETED, body)
      }).catch((err) => {
        console.error("Error in commit_segment:", err)
      })
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
    // start initialization handshake when piping to sync hosts is established
    // run asynchronously and don't block pipe establishment
    // (actual initHandshake is invoked by masterfree/ndb.ts per connection)
  }

  // guard initializer will be set in constructor to a noop; real initializer attached by initHandshake
  private initHandshakeCalledGuard: (() => void) | null = null

  // handshake state
  private initPromise: Promise<string> | null = null
  private initResolved = false

  /**
   * Initiate initialization handshake: send INIT_DB and wait for INIT_DB_ACCEPTED responses until syncQuorum
   * Returns resolved max advance id string when quorum reached.
   */
  initHandshake(syncQuorum: number, timeoutMs: number = 30000): Promise<string> {
    if (this.initPromise) return this.initPromise

    // ensure subscription done before publish
    const myNodeId = this.sysRealm.getRouter().getId()
    const responses: Map<string, string> = new Map()

    const topic = Event.INIT_DB_ACCEPTED + '.' + myNodeId
    const onResponse = (body: BODY_INIT_DB_ACCEPTED | any, opt: any) => {
      try {
        // prefer responder id from headers.owner; fall back to body.nodeId for compatibility
        const nodeId = (opt && opt.headers && opt.headers.owner) ? opt.headers.owner : (body && (body as BODY_INIT_DB_ACCEPTED).nodeId ? (body as BODY_INIT_DB_ACCEPTED).nodeId : 'unknown')
        const last = (body && (body as BODY_INIT_DB_ACCEPTED).lastSeenAdvanceId) ? (body as BODY_INIT_DB_ACCEPTED).lastSeenAdvanceId : ''
        responses.set(nodeId, last)
      if (responses.size >= syncQuorum && !this.initResolved) {
          // compute max
          let maxVal = ''
          for (const v of responses.values()) {
            if (maxVal === '' || maxVal < v) maxVal = v
          }
          this.initResolved = true
          cleanup()
          resolveFn(maxVal)
        }
      } catch (err) {
        console.error('error in initHandshake onResponse', err)
      }
    }

    const cleanup = () => {
      try { if (subId) this.api.unsubscribe(subId) } catch (e) {}
      if (timeoutTimer) clearTimeout(timeoutTimer)
    }

    let resolveFn: (v: string) => void = () => {}
    let rejectFn: (e: any) => void = () => {}
    let timeoutTimer: NodeJS.Timeout | null = null

    let subId: any = null
    this.initPromise = new Promise<string>((resolve, reject) => {
      resolveFn = resolve
      rejectFn = reject
      // subscribe first
        this.api.subscribe(topic, onResponse).then((sid: any) => {
         subId = sid
        // publish init request
        const body: BODY_INIT_DB = { nodeId: myNodeId }
        // include owner header to ensure recipients can identify the requester
        this.api.publish(Event.INIT_DB, body, {exclude_me: false, headers: { owner: myNodeId }})
        // start timeout
        timeoutTimer = setTimeout(() => {
          if (!this.initResolved) {
            cleanup()
            reject(new Error('initHandshake timeout'))
          }
        }, timeoutMs)
      }).catch((err) => {
        reject(err)
      })
    })

    // expose guard so listenStageOne can call this once subscription/piping is established
    this.initHandshakeCalledGuard = () => { /* no-op placeholder to signal started */ }

    return this.initPromise
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
    let buffer = this.getHystoryBuffer(event.advanceId.segment, event.shard)
    buffer.addEvent(event)
    if (buffer.count() !== event.advanceId.offset) {
      console.error('serment position is not equal', buffer.count(), event.advanceId.offset)
    }
    await this.ensureRealm(event.realm)
  }

  async ensureRealm (realm: string) {
    if (!this.realms.has(realm)) {
      await History.createHistoryTables(this.dbFactory.getMainDb(), realm)
      this.realms.set(realm, "ok")
    }
  }

  async commit_segment (advanceSegment: string, segment: string) {
    let buffer = this.bufferToWrite.get(advanceSegment)
    if (buffer) {
      let effectId = await this.dbSaveSegment(buffer, segment)
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

  async dbSaveSegment (historyBuffer: HistoryBuffer, segment: string): Promise<string[]> {
    const db: sqlite.Database = this.dbFactory.getMainDb()
    let result: string[] = []
    let offset: number = 0

    for (let row of historyBuffer.getContent()) {
      await this.ensureRealm(row.realm)
      let eventId: string = segment + keyId(++offset)
      await History.saveEventHistory(db, row.realm, eventId, historyBuffer.getShard(), row.uri, row.data, row.opt)
      result.push(eventId) // keep event position in result array
    }
    return result
  }
}
