import MSG from '../messages'
import { BaseRealm } from '../realm'
import { HyperClient } from '../hyper/client'
import { mergeMin, keyDate, ProduceId } from './makeid'
import { QuorumEdge } from './quorum_edge'
import { ComplexId } from './makeid'
import { EVENT_DRAFT_SEGMENT, StartDraftSegmentMessage, SyncIdMessage } from './synchronizer.h'

type AdvanceStage = {
  advanceOwner: string
  advanceSegment: string
  draftOwner: string
  draftId: ComplexId
  vouters: Set<string>
}

interface Headers {
  advanceOwner?: string
  advanceSegment?: string
  draftOwner?: string
  draftId?: ComplexId
  step?: any
  syncId?: any
  maxId?: ComplexId
}

interface Opt {
  headers: Headers
  sid: string
}

export class SessionEntrySync {
  constructor (client: HyperClient) {
  }
}

export class StageOneTask {
  private realm: BaseRealm
  private majorLimit: number
  private advanceMap: Map<string, AdvanceStage>
  private makeId: ProduceId
  private recentValue: string
  private advanceIdHeap: Map<string, Set<string>>
  private doneHeap: Map<string, Set<string>>
  private draftHeap: Set<string>
  private api: HyperClient
  private syncQuorum: QuorumEdge<string, string, any>

  constructor(sysRealm: BaseRealm, majorLimit: number) {
    this.realm = sysRealm
    this.majorLimit = majorLimit
    this.advanceMap = new Map()
    this.makeId = new ProduceId((date: any) => keyDate(date))

    this.recentValue = ''
    this.advanceIdHeap = new Map()
    this.doneHeap = new Map()
    this.draftHeap = new Set()

    // build api before new session handler to not to be caught
    this.api = sysRealm.buildApi()

    this.api.subscribe(EVENT_DRAFT_SEGMENT, this.event_draftSegment.bind(this))

    sysRealm.on(MSG.SESSION_JOIN, (session: any) => {})
    sysRealm.on(MSG.SESSION_LEAVE, (session: any) => {})

    this.syncQuorum = new QuorumEdge((advanceSegment: any, value: any) => {
      console.log('QSYNC!', advanceSegment, '=>', value)
      this.api.publish('commitSegment', null, { headers: { advanceSegment, readyId: value } })
    }, mergeMin)

    this.api.subscribe('makeSegmentId', (body: any, opt: Opt) => {
      console.log('=> receive MAKE-ID', body, opt.headers)
      const advanceStageMessage = <StartDraftSegmentMessage> opt.headers
      this.syncQuorum.vote(opt.sid, advanceStageMessage.advanceSegment, 1)
    })
    this.api.subscribe('syncId', (body: any, opt: Opt) => {
      console.log('SYNC-ID', body, opt)
      const syncIdMessage = <SyncIdMessage> opt.headers
      this.makeId.reconcilePos(syncIdMessage.maxId.dt, syncIdMessage.maxId.id)
      this.syncQuorum.vote(opt.sid, syncIdMessage.advanceSegment, syncIdMessage.syncId)
    })
    this.api.subscribe('generateSegment', this.event_generateSegment.bind(this))
    this.api.subscribe(EVENT_DRAFT_SEGMENT, this.event_draftSegment.bind(this))
  }

  // generate new segment id for each advanceId
  // if advanceId is duplicated new segment is not generated
  // input headers: advanceOwner, advanceSegment
  event_generateSegment(body: any, opt: Opt) {
    const advanceOwner = opt.headers.advanceOwner!
    const advanceSegment = opt.headers.advanceSegment!
    const advanceId = advanceOwner + ':' + advanceSegment
    if (!this.advanceMap.has(advanceId)) {
      const draftId: ComplexId = this.makeId.generateIdRec()
      const draftOwner: string = this.realm.getRouter().getId()
      const vouters = new Set<string>()
      vouters.add(draftOwner)
      this.advanceMap.set(advanceId, { advanceOwner, advanceSegment, draftOwner, draftId, vouters })
      this.api.publish(EVENT_DRAFT_SEGMENT, null, { headers: { advanceOwner, advanceSegment, draftOwner, draftId } })
    }
  }

  // when another generator made draft shift my generator
  event_draftSegment(body: any, opt: Opt) {
    const changed = this.makeId.reconcilePos(opt.headers.draftId!.dt, opt.headers.draftId!.id)
    // todo register in advanceMap

    const draftOwner = opt.headers.draftOwner!
    const advanceOwner = opt.headers.advanceOwner!
    const advanceSegment = opt.headers.advanceSegment!
    const advanceId = advanceOwner + ':' + advanceSegment
    const draftId = opt.headers.draftId!.dt + opt.headers.draftId!.id

    this.draftHeap.add(draftId)

    if (this.doneHeap.has(advanceId)) {
      const vouterSet = this.doneHeap.get(advanceId)!
      vouterSet.add(draftOwner)
      while (this.draftHeap.size > this.advanceIdHeap.size) {
        this.extractDraft()
      }
      return
    }

    if (!this.advanceIdHeap.has(advanceId)) {
      this.advanceIdHeap.set(advanceId, new Set())
    }
    const vouterSet = this.advanceIdHeap.get(advanceId)!
    vouterSet.add(draftOwner)

    while (this.draftHeap.size > this.advanceIdHeap.size) {
      this.extractDraft()
    }

    if (vouterSet.size >= this.majorLimit) {
      this.advanceIdHeap.delete(advanceId)
      this.doneHeap.set(advanceId, vouterSet)
      const challenger = this.extractDraft()
      this.api.publish('challengerExtract', null, { headers: { challenger, advanceOwner, advanceSegment } })
    }
  }

  reconcilePos(segment: string, offset: number): boolean {
    return this.makeId.reconcilePos(segment, offset)
  }

  startActualizePrefixTimer() {
    this.makeId.actualizePrefix()
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 7000)
  }

  getRecentValue() {
    return this.recentValue
  }

  setRecentValue(newRecentValue: string) {
    if (this.recentValue > newRecentValue) {
      throw Error('failed to set recentValue: "' + this.recentValue + '">"' + newRecentValue + '"')
    }
    this.recentValue = newRecentValue
  }

  // extract minimal from draftHeap and save it to recentValue
  extractDraft(): string | undefined {
    let minValue: string | undefined
    for (const cur of this.draftHeap.values()) {
      minValue = (minValue && minValue < cur) ? minValue : cur
    }
    if (minValue) {
      this.draftHeap.delete(minValue)
      this.recentValue = minValue
    }
    return minValue
  }
}
