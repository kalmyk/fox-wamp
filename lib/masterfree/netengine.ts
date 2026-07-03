import { ActorPush, BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } from '../realm'
import { Router } from '../router'
import { HyperClient } from '../hyper/client'
import { MemKeyValueStorage } from '../mono/memkv'
import { AdvanceOffsetId, Event, INTRA_REALM_NAME, BODY_BEGIN_ADVANCE_SEGMENT, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_OVER, BODY_ADVANCE_SEGMENT_FAILED, BODY_INIT_ENTRY_ACCEPTED } from './hyper.h'
import EventEmitter from 'events'

export const TOTAL_SHARDS_COUNT = 8
export const INIT_ADVANCE_SEGMENTS_COMPLETED = 'init-advance-segments-completed'

export class HistorySegment {

  private content: Map<number,ActorPush> = new Map()
  private advanceStamp: number
  private offsetGenerator: number = 0
  private shardTag: number = 0

  constructor (advanceStamp: number, shardTag: number = 0) {
    this.advanceStamp = advanceStamp
    this.shardTag = shardTag
  }

  getShardTag(): number {
    return this.shardTag
  }

  size(): number {
    return this.content.size
  }

  getDestinationTopics(): Array<string> {
    return [Event.keepAdvanceHistoryTopic(this.shardTag)]
  }

  addActorPush (actor: ActorPush): AdvanceOffsetId {
    this.offsetGenerator++
    this.content.set(this.offsetGenerator, actor)
    return { segment: this.advanceStamp, offset: this.offsetGenerator }
  }

  fetchActor (advanceId: AdvanceOffsetId): ActorPush | undefined {
    if (advanceId.segment !== this.advanceStamp) {
      throw Error("advance is not identical " + advanceId.segment + " " + this.advanceStamp)
    }
    let actor = this.content.get(advanceId.offset)
    if (actor) {
      this.content.delete(advanceId.offset)
    }
    return actor
  }

  getAdvanceStamp(): number {
    return this.advanceStamp
  }
}

export class NetEngine extends BaseEngine {
  private netEngineMill: NetEngineMill

  constructor (netEngineMill: NetEngineMill) {
    super()
    this.netEngineMill = netEngineMill
    this.supportsRetainedEventSync = false
    this.supportsSnapshotSubscription = false
  }

  // @return promise
  doPush (actor: ActorPush) {
    return this.netEngineMill.saveHistory(actor, this.getRealmName())
  }

  getHistoryAfter (after: string, uri: string[], cbEmitRow: any): Promise<any> {
    return Promise.resolve()
    // return History.getEventHistory(
    //   getMainDb(),
    //   engine.getRealmName(),
    //   { fromId: after, uri },
    //   (event) => {
    //     cbEmitRow({
    //       qid: event.id,
    //       uri: event.uri,
    //       data: unSerializeData(event.body)
    //     })
    //   }
    // )
  }
}

export class NetEngineMill extends EventEmitter {

  private curSegment: HistorySegment | null = null
  private recentAdvanceStamp: number = 0
  private localSegments = new Map<number, HistorySegment>()
  private configQuorum: number
  private router: Router
  private sysRealm: BaseRealm
  private sysApi: HyperClient
  private lastShard: number = 0
  private initReceived: Map<string, number> = new Map() // sync node -> lastSeenAdvanceId
  private initReceivedDone: boolean = false

  constructor (router: Router, configQuorum: number) {
    super()
    this.router = router
    this.configQuorum = configQuorum
    this.lastShard = Math.floor(Math.random() * TOTAL_SHARDS_COUNT)
    this.sysRealm = new BaseRealm(router, new BaseEngine())

    this.router.initRealm(INTRA_REALM_NAME, this.sysRealm)
    this.sysRealm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
    this.sysApi = this.sysRealm.buildApi()

    this.sysApi.subscribe(Event.INIT_ENTRY_ACCEPTED + '.' + this.router.getId(), this.event_init_entry_accepted.bind(this))
    this.sysApi.subscribe(Event.TRIM_ADVANCE_SEGMENT + '.*', this.event_trim_advance_segment.bind(this))

    this.sysApi.subscribe(Event.ADVANCE_SEGMENT_RESOLVED + '.' + this.router.getId(), (data: any, opt: any) => {
      this.advance_segment_resolved(data)
    })

    this.sysApi.subscribe(Event.ADVANCE_SEGMENT_FAILED, (data: BODY_ADVANCE_SEGMENT_FAILED) => {
      this.event_advance_segment_failed(data)
    })

    this.sysApi.subscribe('dispatchEvent', (data: any, opt: any) => {
      console.log('=> dispatchEvent', opt.headers.qid)
      this.dispatchEvent(opt.headers)
    })
  }

  nextShardTag(): number {
    this.lastShard = (this.lastShard + 1) % TOTAL_SHARDS_COUNT
    return this.lastShard
  }

  computeMaxId(initReceived: Map<string, number>): number {
    let maxId = 0
    for (let [key, value] of initReceived) {
      if (value > maxId) {
        maxId = value
      }
    }
    return maxId
  }

  event_init_entry_accepted(data: BODY_INIT_ENTRY_ACCEPTED, opt: any) {
    this.initReceived.set(data.syncNodeId, data.lastSeenAdvanceId)
    if (!this.initReceivedDone && this.initReceived.size >= this.configQuorum) {
      this.initReceivedDone = true
      const maxReceivedId = this.computeMaxId(this.initReceived)
      this.recentAdvanceStamp = Math.max(this.recentAdvanceStamp, maxReceivedId)
      this.emit(INIT_ADVANCE_SEGMENTS_COMPLETED, this.recentAdvanceStamp)
    }
  }

  event_trim_advance_segment(data: BODY_TRIM_ADVANCE_SEGMENT) {
    if (!data.advanceStamp) {
      console.error('ERROR: no advanceStamp in package')
      return
    }
    // to do voute for complete
    if (this.curSegment) {
      if (data.advanceStamp === this.curSegment.getAdvanceStamp()) {
        // it will be required to create new segment at the next inbound message
        console.log('Event.ADVANCE_SEGMENT_OVER =>', data.advanceStamp)
        const body: BODY_ADVANCE_SEGMENT_OVER = {
          advanceStamp: data.advanceStamp,
          advanceOwner: this.router.getId(),
          shardTag: this.curSegment.getShardTag()
        }
        this.curSegment = null
        this.sysApi.publish(Event.ADVANCE_SEGMENT_OVER, body, {exclude_me: false})
      } else {
        console.warn('warn: new segment is not accepted, cur:', this.curSegment.getAdvanceStamp(), 'inbound:', data.advanceStamp)
      }
    }
  }

  getSegment () : HistorySegment {
    if (this.curSegment) {
      return this.curSegment
    }
    let curAdvanceStamp = Math.max(this.recentAdvanceStamp + 1, Date.now())
    this.recentAdvanceStamp = curAdvanceStamp
    this.curSegment = new HistorySegment(curAdvanceStamp, this.nextShardTag())
    this.localSegments.set(curAdvanceStamp, this.curSegment)
    // todo: sent all open advance segments, in case of sharding that keeps order
    const body: BODY_BEGIN_ADVANCE_SEGMENT = {
      advanceStamp: curAdvanceStamp,
      advanceOwner: this.router.getId(),
      shardTag: this.curSegment.getShardTag()
    }
    this.sysApi.publish(Event.BEGIN_ADVANCE_SEGMENT, body)
    return this.curSegment
  }

  findSegment (advanceStamp: number) : HistorySegment | undefined {
    return this.localSegments.get(advanceStamp)
  }

  deleteSegment (advanceStamp: number) {
    return this.localSegments.delete(advanceStamp)
  }

  advance_segment_resolved (syncMessage: any) {
    let segment = this.findSegment(syncMessage.advanceStamp)
    if (!segment) {
      return
    }
    console.log('advance-segment-resolved', syncMessage.advanceStamp, syncMessage.pkg)
    for (let event of syncMessage.pkg) {
      let actor = segment.fetchActor(event.advanceId)
      if (actor) {
        actor.setEventId(event.qid)
        actor.confirm({ sid: event.sid })
      } else {
        console.log("actor not found by advanceId", event.advanceId)
      }
    }
    if (syncMessage.final) {
      this.deleteSegment(syncMessage.advanceStamp)
      if (segment.size() > 0) {
        console.log("removing not empty segment")
      }
    }
  }

  // @return promise
  saveHistory (actor: ActorPush, realmName: string) {
    let segment = this.getSegment()
    let advanceId = segment.addActorPush(actor)

    const event: BODY_KEEP_ADVANCE_HISTORY = {
      advanceOwner: this.router.getId(),
      advanceId: advanceId,
      shard: segment.getShardTag(),
      realm: realmName,
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt(),
      sid: actor.getSid()
    }
    const all = []
    for (let topic of segment.getDestinationTopics()) {
      all.push(this.sysApi.publish(topic, event))
    }
    return Promise.all(all)
  }

  dispatchEvent (eventData: any) {
    const realm = this.router.findRealm(eventData.realm)
    if (realm) {
      realm.getEngine().disperseToSubs({
        qid: eventData.qid,
        uri: eventData.uri,
        data: unSerializeData(eventData.data),
        opt: eventData.opt,
        sid: eventData.sid
      })
    }
  }

  event_advance_segment_failed(body: BODY_ADVANCE_SEGMENT_FAILED) {
    if (body.advanceOwner !== this.router.getId()) {
      return
    }
    const failedSegment = this.localSegments.get(body.advanceStamp)
    if (!failedSegment) {
      console.warn(`advance_segment_failed: segment ${body.advanceStamp} not found, already resolved?`)
      return
    }
    console.warn(`advance_segment_failed: segment ${body.advanceStamp} (${body.reason}), retrying`)

    // Assign a new segment number — StageOne's recentAdvanceStamp guard requires it to be
    // strictly greater than the failed one, so a fresh timestamp is sufficient.
    const newAdvanceStamp = Math.max(this.recentAdvanceStamp + 1, Date.now())
    this.recentAdvanceStamp = newAdvanceStamp

    this.localSegments.delete(body.advanceStamp)
    this.localSegments.set(newAdvanceStamp, failedSegment)

    // Re-trigger consensus directly — storage has already received KEEP_ADVANCE_HISTORY
    // for this data, so we only need a new ADVANCE_SEGMENT_OVER to start a fresh vote.
    const overBody: BODY_ADVANCE_SEGMENT_OVER = {
      advanceStamp: newAdvanceStamp,
      advanceOwner: this.router.getId(),
      shardTag: failedSegment.getShardTag()
    }
    this.sysApi.publish(Event.ADVANCE_SEGMENT_OVER, overBody, {exclude_me: false})
  }

  getRecentAdvanceSegment(): number {
    return this.recentAdvanceStamp
  }
}
