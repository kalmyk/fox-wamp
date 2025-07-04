import MSG from '../messages'
import { BaseRealm } from '../realm'
import { HyperClient } from '../hyper/client'
import { keyDate, ProduceId, keyComplexId } from './makeid'
import { ComplexId } from './makeid'
import { Event, BODY_DRAFT_SEGMENT, BODY_GENERATE_SEGMENT, BODY_CHALLENGER_EXTRACT } from './hyper.h'

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
  maxId?: ComplexId
}

export class StageOneTask {
  private realm: BaseRealm
  private majorLimit: number
  private advanceMap: Map<string, AdvanceStage> = new Map()
  private makeId: ProduceId
  private recentValue: string
  private advanceIdHeap: Map<string, Set<string>>
  private doneHeap: Map<string, Set<string>>
  private draftHeap: Map<string, string[]>  // draftOwner -> set of draftId
  private api: HyperClient

  constructor(sysRealm: BaseRealm, majorLimit: number) {
    this.realm = sysRealm
    this.majorLimit = majorLimit
    this.makeId = new ProduceId((date: any) => keyDate(date))

    this.recentValue = ''
    this.advanceIdHeap = new Map()
    this.doneHeap = new Map()
    this.draftHeap = new Map()

    // build api before new session handler to not to be caught
    this.api = sysRealm.buildApi()

    sysRealm.on(MSG.SESSION_JOIN, (session: any) => {})
    sysRealm.on(MSG.SESSION_LEAVE, (session: any) => {})

    this.api.subscribe(Event.GENERATE_SEGMENT, this.event_generate_segment.bind(this))
    this.api.subscribe(Event.DRAFT_SEGMENT, this.event_draft_segment.bind(this))
  }

  // generate new segment id for each advanceId
  // if advanceId is duplicated new segment is not generated
  // input headers: advanceOwner, advanceSegment
  event_generate_segment(body: BODY_GENERATE_SEGMENT) {
    const advanceId = body.advanceOwner + ':' + body.advanceSegment
    if (!this.advanceMap.has(advanceId)) {
      const draftId: ComplexId = this.makeId.generateIdRec()
      const draftOwner: string = this.realm.getRouter().getId()
      const vouters = new Set<string>()
      vouters.add(draftOwner)
      const stage: AdvanceStage = {
        advanceOwner: body.advanceOwner, advanceSegment: body.advanceSegment, draftOwner, draftId, vouters
      }
      this.advanceMap.set(advanceId, stage)
      const draftSegment: BODY_DRAFT_SEGMENT = {
        advanceOwner: body.advanceOwner, advanceSegment: body.advanceSegment, draftOwner, draftId
      }
      this.api.publish(Event.DRAFT_SEGMENT, draftSegment, {exclude_me: false})
    }
  }

  // when another generator made draft shift my generator
  event_draft_segment(body: BODY_DRAFT_SEGMENT) {
    this.makeId.reconcilePos(body.draftId.dt, body.draftId.id)

    const draftOwner = body.draftOwner
    const advanceOwner = body.advanceOwner
    const advanceSegment = body.advanceSegment
    const advanceId = advanceOwner + ':' + advanceSegment
    const draftId = keyComplexId(body.draftId)

    if (!this.draftHeap.has(draftOwner)) {
      this.draftHeap.set(draftOwner, [])
    }
    const draftStack = this.draftHeap.get(draftOwner)!
    draftStack.push(draftId)

    if (this.doneHeap.has(advanceId)) {
      const vouterSet = this.doneHeap.get(advanceId)!
      vouterSet.add(draftOwner)
      return
    }

    if (!this.advanceIdHeap.has(advanceId)) {
      this.advanceIdHeap.set(advanceId, new Set())
    }
    const vouterSet = this.advanceIdHeap.get(advanceId)!
    vouterSet.add(draftOwner)

    if (vouterSet.size >= this.majorLimit) {
      this.advanceIdHeap.delete(advanceId)
      this.doneHeap.set(advanceId, vouterSet)
      const challengerBody: BODY_CHALLENGER_EXTRACT = {
        advanceOwner,
        advanceSegment,
        challenger: this.extractDraft(vouterSet)
      }
      this.api.publish(Event.CHALLENGER_EXTRACT, challengerBody, {exclude_me: false})
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
  extractDraft(vouters: Set<string>): string {
    let minValue: string | undefined
    for (const curVouter of vouters.values()) {
      const stack: string[] = this.draftHeap.get(curVouter)!
      const cur = stack[0]
      minValue = (minValue && minValue < cur) ? minValue : cur
    }
    if (!minValue) {
      throw Error('No draft found in draftHeap for vouters: ' + Array.from(vouters).join(', '))
    }
    for ( const curHeap of this.draftHeap.values()) {
      // remove all less or equal values
      while (curHeap.length > 0 && curHeap[0] <= minValue) {
        curHeap.shift()
      }
    }
    this.setRecentValue(minValue)
    return minValue
  }
}

export class StageTwoTask {

  private realm: BaseRealm
  private majorLimit: number

  constructor(sysRealm: BaseRealm, majorLimit: number) {
    this.realm = sysRealm
    this.majorLimit = majorLimit
  }

}
