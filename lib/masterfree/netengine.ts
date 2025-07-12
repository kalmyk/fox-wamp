import { Actor, BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } from '../realm'
import Router from '../router'
import { HyperClient } from '../hyper/client'
import { MemKeyValueStorage } from '../mono/memkv'
import { AdvanceOffsetId, Event, INTRA_REALM_NAME, BODY_BEGIN_ADVANCE_SEGMENT, BODY_KEEP_ADVANCE_HISTORY, BODY_TRIM_ADVANCE_SEGMENT } from './hyper.h'

export class HistorySegment {
  
  private content: Map<number,Actor> = new Map()
  private advanceSegment: string
  private generator: number = 0

  constructor (advanceSegment: string) {
    this.advanceSegment = advanceSegment
  }

  addActor (actor: Actor): AdvanceOffsetId {
    this.generator++
    this.content.set(this.generator, actor)
    return { segment: this.advanceSegment, offset: this.generator }
  }

  fetchActor (advanceId: AdvanceOffsetId): Actor | undefined {
    if (advanceId.segment !== this.advanceSegment) {
      throw Error("advance is not identical "+advanceId.segment+" "+this.advanceSegment)
    }
    let actor = this.content.get(advanceId.offset)
    if (actor) {
      this.content.delete(advanceId.offset)
    }
    return actor
  }

  getAdvanceSegment(): string {
    return this.advanceSegment
  }
}

export class NetEngine extends BaseEngine {
  private netEngineMill: NetEngineMill

  constructor (netEngineMill: NetEngineMill) {
    super()
    this.netEngineMill = netEngineMill
  }

  // @return promise
  doPush (actor: any) {
    return this.netEngineMill.saveHistory(actor, this.getRealmName())
  }

  getHistoryAfter (after: string, uri: string, cbEmitRow: any): Promise<any> {
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

export class NetEngineMill {

  private curSegment: HistorySegment | null = null
  private advanceSegmentGen: number = 0
  private segments = new Map()
  private router: Router
  private sysRealm: BaseRealm
  private sysApi: HyperClient

  constructor (router: any) {
    this.router = router
    this.sysRealm = new BaseRealm(router, new BaseEngine())

    this.router.initRealm(INTRA_REALM_NAME, this.sysRealm)
    this.sysRealm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
    this.sysApi = this.sysRealm.buildApi()

    this.sysApi.subscribe(Event.TRIM_ADVANCE_SEGMENT+'.*', (data: BODY_TRIM_ADVANCE_SEGMENT) => {
      // to do voute for complete
      if (!data.advanceSegment) {
        console.error('ERROR: no advanceSegment in package')
      }
      if (this.curSegment) {
        if (data.advanceSegment == this.curSegment.getAdvanceSegment()) {
          // it will be required to create new segment at the next inbound message
          this.curSegment = null
          console.log('Event.ADVANCE_SEGMENT_OVER =>', data.advanceSegment)
          const body: BODY_BEGIN_ADVANCE_SEGMENT = {
            advanceSegment: data.advanceSegment,
            advanceOwner: this.router.getId(),
          }
          this.sysApi.publish(Event.ADVANCE_SEGMENT_OVER, body)
        } else {
          console.warn('warn: new segment is not accepted, cur:', this.curSegment.getAdvanceSegment(), 'inbound:', data.advanceSegment)
        }
      }
    })

    this.sysApi.subscribe(Event.ADVANCE_SEGMENT_RESOLVED + '.' + this.router.getId(), (data: any, opt: any) => {
      this.advance_segment_resolved(opt.headers)
    })

    this.sysApi.subscribe('dispatchEvent', (data: any, opt: any) => {
      console.log('=> dispatchEvent', opt.headers.qid)
      this.dispatchEvent(opt.headers)
    })
  }

  getSegment () {
    if (this.curSegment) {
      return this.curSegment
    }
    this.advanceSegmentGen++
    let curAdvanceSegment = '' + this.router.getId() + '-' + this.advanceSegmentGen
    this.curSegment = new HistorySegment(curAdvanceSegment)
    this.segments.set(curAdvanceSegment, this.curSegment)
    // todo: sent all open advance segments, in case of sharding that keeps order
    const body: BODY_BEGIN_ADVANCE_SEGMENT = {
      advanceSegment: curAdvanceSegment,
      advanceOwner: this.router.getId(),
    }
    this.sysApi.publish(Event.BEGIN_ADVANCE_SEGMENT, body)
    return this.curSegment
  }

  findSegment (advanceSegment: string) {
    return this.segments.get(advanceSegment)
  }

  deleteSegment (advanceSegment: string) {
    return this.segments.delete(advanceSegment)
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
        actor.confirm()
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
  saveHistory (actor: any, realmName: string) {
    let segment = this.getSegment()
    let advanceId = segment.addActor(actor)

    const event: BODY_KEEP_ADVANCE_HISTORY = {
      advanceId: advanceId,
      realm: realmName,
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt(),
      sid: actor.getSid()
    }
    return this.sysApi.publish(Event.KEEP_ADVANCE_HISTORY, null, { headers: event})
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
}
