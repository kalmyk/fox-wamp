import MSG from '../messages'
import { BaseRealm } from '../realm'
import { HyperClient } from '../hyper/client'
import { keyDate, ProduceId, keyComplexId } from './makeid'
import { ComplexId } from './makeid'
import { Event, BODY_PICK_CHALLENGER, BODY_GENERATE_DRAFT, BODY_ELECT_SEGMENT, BODY_ADVANCE_SEGMENT_RESOLVED } from './hyper.h'

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
  private syncQuorum: number
  private advanceMap: Map<string, AdvanceStage> = new Map()
  private makeId: ProduceId
  private recentValue: string = ''
  private advanceIdHeap: Map<string, Set<string>> = new Map()
  private doneHeap: Map<string, Set<string>> = new Map()
  private draftHeap: Map<string, string[]> = new Map() // draftOwner -> set of draftId
  private api: HyperClient

  constructor(sysRealm: BaseRealm, syncQuorum: number) {
    this.realm = sysRealm
    this.syncQuorum = syncQuorum
    this.makeId = new ProduceId((date: any) => keyDate(date))

    // build api before new session handler to not to be caught
    this.api = sysRealm.buildApi()

    sysRealm.on(MSG.SESSION_JOIN, (session: any) => {})
    sysRealm.on(MSG.SESSION_LEAVE, (session: any) => {})

    this.api.subscribe(Event.GENERATE_DRAFT, this.event_generate_draft.bind(this))
    this.api.subscribe(Event.PICK_CHALLENGER, this.event_pick_challenger.bind(this))
  }

  listenEntry(client: HyperClient) {
    client.pipe(this.api, Event.GENERATE_DRAFT, {exclude_me: false})
  }

  listenStageOne(client: HyperClient) {
    client.pipe(this.api, Event.PICK_CHALLENGER, {exclude_me: false})
  }

  // generate new segment id for each advanceId
  // if advanceId is duplicated new segment is not generated
  // input headers: advanceOwner, advanceSegment
  event_generate_draft(body: BODY_GENERATE_DRAFT) {
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
      const draftSegment: BODY_PICK_CHALLENGER = {
        advanceOwner: body.advanceOwner, advanceSegment: body.advanceSegment, draftOwner, draftId
      }
      this.api.publish(Event.PICK_CHALLENGER, draftSegment, {exclude_me: false})
    }
  }

  // when another generator made draft shift my generator
  event_pick_challenger(body: BODY_PICK_CHALLENGER) {
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

    if (vouterSet.size >= this.syncQuorum) {
      this.advanceIdHeap.delete(advanceId)
      this.doneHeap.set(advanceId, vouterSet)
      const challengerBody: BODY_ELECT_SEGMENT = {
        advanceOwner,
        advanceSegment,
        challenger: this.extractDraft(vouterSet)
      }
      this.api.publish(Event.ELECT_SEGMENT, challengerBody, {exclude_me: false})
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
  private syncQuorum: number
  private api: HyperClient
  private readyQuorum: Map<string, Set<string>> = new Map() // advanceSegment -> set of readyId
  private recentValue: string = ''

  constructor(sysRealm: BaseRealm, syncQuorum: number) {
    this.realm = sysRealm
    this.syncQuorum = syncQuorum
    this.api = sysRealm.buildApi()

    this.api.subscribe(Event.ELECT_SEGMENT, (body: BODY_ELECT_SEGMENT, opts: any) => {
      console.log('=> Event.ELECT_SEGMENT', body)
      this.event_elect_segment(body)
    })

  }

  listenStageOne(client: HyperClient) {
    client.pipe(this.api, Event.ELECT_SEGMENT, {exclude_me: false})
  }

  event_elect_segment(body: BODY_ELECT_SEGMENT) {
    const advanceSegment = body.advanceSegment
    const challenger = body.challenger

    if (!this.readyQuorum.has(advanceSegment)) {
      this.readyQuorum.set(advanceSegment, new Set())
    }
    const readySet = this.readyQuorum.get(advanceSegment)!
    readySet.add(challenger)

    if (readySet.size >= this.syncQuorum) {
      this.readyQuorum.delete(advanceSegment)
      let maxValue = '';
      readySet.forEach((id) => {
        if (maxValue === '' || maxValue < id) {
          maxValue = id
        }
      })
      const msg: BODY_ADVANCE_SEGMENT_RESOLVED = {
        advanceSegment,
        advanceOwner: body.advanceOwner,
        segment: maxValue
      }
      this.api.publish(Event.ADVANCE_SEGMENT_RESOLVED, msg, {})
    }
  }

}
