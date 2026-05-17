import { ActorPush, BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } from '../realm'
import { Router } from '../router'
import { HyperClient } from '../hyper/client'
import { MemKeyValueStorage } from '../mono/memkv'
import { AdvanceOffsetId, Event, INTRA_REALM_NAME, BODY_BEGIN_ADVANCE_SEGMENT, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT, BODY_ADVANCE_SEGMENT_OVER, BODY_INIT_ENTRY_ACCEPTED } from './hyper.h'
import EventEmitter from 'events'

export const TOTAL_SHARDS_COUNT = 1048576
export const INIT_ADVANCE_SEGMENTS_COMPLETED = 'init-advance-segments-completed'

export class HistorySegment {

  private content: Map<number,ActorPush> = new Map()
  private advanceSegment: number
  private generator: number = 0
  private shard: number = 0

  constructor (advanceSegment: number, shard: number = 0) {
    this.advanceSegment = advanceSegment
    this.shard = shard
  }

  getShardTag(): number {
    return this.shard
  }

  size(): number {
    return this.content.size
  }

  getDestinationTopics(): Array<string> {
    // to do: sharding by topic
    return [Event.KEEP_ADVANCE_HISTORY /* + '.' + (this.shard % 16) */]
  }

  addActorPush (actor: ActorPush): AdvanceOffsetId {
    this.generator++
    this.content.set(this.generator, actor)
    return { segment: this.advanceSegment, offset: this.generator }
  }

  fetchActor (advanceId: AdvanceOffsetId): ActorPush | undefined {
    if (advanceId.segment !== this.advanceSegment) {
      throw Error("advance is not identical " + advanceId.segment + " " + this.advanceSegment)
    }
    let actor = this.content.get(advanceId.offset)
    if (actor) {
      this.content.delete(advanceId.offset)
    }
    return actor
  }

  getAdvanceSegment(): number {
    return this.advanceSegment
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
  private advanceSegmentGen: number = 0
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

    this.sysApi.subscribe('dispatchEvent', (data: any, opt: any) => {
      console.log('=> dispatchEvent', opt.headers.qid)
      this.dispatchEvent(opt.headers)
    })
  }

  nextShard(): number {
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
    console.log('rx:INIT_ENTRY_ACCEPTED', data)
    this.initReceived.set(data.nodeId, data.lastSeenAdvanceId)
    if (!this.initReceivedDone && this.initReceived.size >= this.configQuorum) {
      this.initReceivedDone = true
      const maxReceivedId = this.computeMaxId(this.initReceived)
      this.advanceSegmentGen = Math.max(this.advanceSegmentGen, maxReceivedId)
      this.emit(INIT_ADVANCE_SEGMENTS_COMPLETED, this.computeMaxId(this.initReceived))
    }
  }

  event_trim_advance_segment(data: BODY_TRIM_ADVANCE_SEGMENT) {
    if (!data.advanceSegment) {
      console.error('ERROR: no advanceSegment in package')
      return
    }
    // to do voute for complete
    if (this.curSegment) {
      if (data.advanceSegment == this.curSegment.getAdvanceSegment()) {
        // it will be required to create new segment at the next inbound message
        console.log('Event.ADVANCE_SEGMENT_OVER =>', data.advanceSegment)
        const body: BODY_ADVANCE_SEGMENT_OVER = {
          advanceSegment: data.advanceSegment,
          advanceOwner: this.router.getId(),
          shardTag: "" + this.curSegment.getShardTag()
        }
        this.curSegment = null
        this.sysApi.publish(Event.ADVANCE_SEGMENT_OVER, body, {exclude_me: false})
      } else {
        console.warn('warn: new segment is not accepted, cur:', this.curSegment.getAdvanceSegment(), 'inbound:', data.advanceSegment)
      }
    }
  }

  getSegment () : HistorySegment {
    if (this.curSegment) {
      return this.curSegment
    }
    this.advanceSegmentGen++
    let curAdvanceSegment = this.advanceSegmentGen
    this.curSegment = new HistorySegment(curAdvanceSegment, this.nextShard())
    this.localSegments.set(curAdvanceSegment, this.curSegment)
    // todo: sent all open advance segments, in case of sharding that keeps order
    const body: BODY_BEGIN_ADVANCE_SEGMENT = {
      advanceSegment: curAdvanceSegment,
      advanceOwner: this.router.getId(),
      shardTag: "" + this.curSegment.getShardTag()
    }
    this.sysApi.publish(Event.BEGIN_ADVANCE_SEGMENT, body)
    return this.curSegment
  }

  findSegment (advanceSegment: number) : HistorySegment | undefined {
    return this.localSegments.get(advanceSegment)
  }

  deleteSegment (advanceSegment: number) {
    return this.localSegments.delete(advanceSegment)
  }

  advance_segment_resolved (syncMessage: any) {
    let segment = this.findSegment(syncMessage.advanceSegment)
    if (!segment) {
      return
    }
    console.log('advance-segment-resolved', syncMessage.advanceSegment, syncMessage.pkg)
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
      this.deleteSegment(syncMessage.advanceSegment)
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

  getAdvanceSegmentGen(): number {
    return this.advanceSegmentGen
  }
}
