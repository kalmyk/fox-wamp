import { BaseRealm } from '../realm'
import { HyperClient } from '../hyper/client'
import { keyDate, ProduceId, keyComplexId } from './makeid'
import { ComplexId } from './makeid'
import {
  Event,
  BODY_PICK_CHALLENGER,
  BODY_GENERATE_DRAFT,
  BODY_ELECT_SEGMENT,
  BODY_ADVANCE_SEGMENT_RESOLVED,
  BODY_ADVANCE_SEGMENT_FAILED,
  BODY_INIT_ENTRY_ACCEPTED,
} from './hyper.h'
import { SESSION_JOIN, SESSION_LEAVE } from '../messages'

const STAGE_TWO_TIMEOUT_MS = 30000

type AdvanceOwnerStateNode = {
  recentAdvanceStamp: number
}

// Per-advanceId voting state — deleted immediately on quorum.
// Stale entries (quorum never reached) are pruned when the same entry owner
// advances to the next segment, which is guaranteed to happen once the
// previous segment resolves.
type StageOneVotingEntry = {
  minDraftId: string
  voters: Set<string>
}

type StageTwoVotingEntry = {
  maxChallenger: string
  voters: Set<string>
  createdAt: number
}

export class StageOneTask {
  private realm: BaseRealm
  private syncQuorum: number
  private myId: string
  private advanceOwnerState: Map<string, AdvanceOwnerStateNode> = new Map()
  private makeId: ProduceId
  private recentValue: string = ''
  private votingEntries: Map<string, StageOneVotingEntry> = new Map()
  private api: HyperClient
  private syncNodeIds: string[]

  constructor(sysRealm: BaseRealm, myId: string, syncQuorum: number, syncNodeIds: string[]) {
    this.realm = sysRealm
    this.syncQuorum = syncQuorum
    this.myId = myId
    this.syncNodeIds = syncNodeIds.filter((nodeId) => nodeId !== myId)
    this.makeId = new ProduceId((date: any) => keyDate(date))

    // build api before new session handler to not to be caught
    this.api = sysRealm.buildApi()

    sysRealm.on(SESSION_JOIN, (session: any) => {})
    sysRealm.on(SESSION_LEAVE, (session: any) => {})

    this.api.subscribe(Event.GENERATE_DRAFT, this.event_generate_draft.bind(this))
    this.api.subscribe(Event.PICK_CHALLENGER + '.' + myId, this.event_pick_challenger.bind(this))
  }

  getAdvanceOwnerState(owner: string): AdvanceOwnerStateNode {
    if (!this.advanceOwnerState.has(owner)) {
      this.advanceOwnerState.set(owner, {recentAdvanceStamp: 0})
    }
    return this.advanceOwnerState.get(owner)!
  }

  getRecentAdvanceSegment(owner: string): number {
    if (!this.advanceOwnerState.has(owner)) {
      return 0
    }
    return this.advanceOwnerState.get(owner)!.recentAdvanceStamp
  }

  async listenEntry(entry: HyperClient, entryId: string) {
    const acceptBody: BODY_INIT_ENTRY_ACCEPTED = {
      syncNodeId: this.myId,
      advanceOwner: entryId,
      lastSeenAdvanceId: this.getRecentAdvanceSegment(entryId)
    }
    await entry.publish(Event.INIT_ENTRY_ACCEPTED + '.' + entryId, acceptBody, { exclude_me: false })
  }

  async listenPeerStageOne(client: HyperClient) {
    await client.pipe(this.api, Event.PICK_CHALLENGER + '.' + this.myId, {exclude_me: false})
  }

  // generate new segment id for each advanceId
  // if advanceId is duplicated new segment is not generated
  event_generate_draft(body: BODY_GENERATE_DRAFT) {
    const ownerState = this.getAdvanceOwnerState(body.advanceOwner)
    const prevSegment = ownerState.recentAdvanceStamp
    if (prevSegment >= body.advanceStamp) {
      return
    }
    // The previous segment is now resolved (entry only advances after receiving ADVANCE_SEGMENT_RESOLVED).
    // Clean up any leftover voting state for it.
    if (prevSegment > 0) {
      this.votingEntries.delete(body.advanceOwner + ':' + prevSegment)
    }
    ownerState.recentAdvanceStamp = body.advanceStamp

    const draftId: ComplexId = this.makeId.generateIdRec()
    const draftOwner: string = this.myId
    const draftSegment: BODY_PICK_CHALLENGER = {
      advanceOwner: body.advanceOwner,
      advanceStamp: body.advanceStamp,
      shardTag: body.shardTag,
      draftOwner,
      draftId
    }
    console.log('Event.GENERATE_DRAFT: draftSegment:', draftSegment)
    for (const syncNodeId of this.syncNodeIds) {
      this.api.publish(Event.PICK_CHALLENGER + '.' + syncNodeId, draftSegment, {exclude_me: false, headers: {owner: this.myId}})
    }
    // TODO: make as event
    this.event_pick_challenger(draftSegment)
  }

  // Collect draft IDs from all sync nodes, select minimum when quorum reached.
  // Late votes for segments below recentAdvanceStamp are discarded — the entry
  // has already moved on, proving that segment is fully resolved.
  event_pick_challenger(body: BODY_PICK_CHALLENGER) {
    this.makeId.reconcilePos(body.draftId.dt, body.draftId.id)

    const draftOwner = body.draftOwner
    const advanceOwner = body.advanceOwner
    const advanceStamp = body.advanceStamp
    const advanceId = advanceOwner + ':' + advanceStamp
    const draftId = keyComplexId(body.draftId)

    // Skip segments already surpassed: entry advances segment only after resolution,
    // so recentAdvanceStamp > advanceStamp proves this segment is done.
    const ownerState = this.advanceOwnerState.get(advanceOwner)
    if (ownerState && ownerState.recentAdvanceStamp > advanceStamp) {
      return
    }

    let entry = this.votingEntries.get(advanceId)
    if (!entry) {
      entry = { minDraftId: draftId, voters: new Set() }
      this.votingEntries.set(advanceId, entry)
    }

    if (draftId < entry.minDraftId) {
      entry.minDraftId = draftId
    }
    entry.voters.add(draftOwner)

    if (entry.voters.size >= this.syncQuorum) {
      const minDraftId = entry.minDraftId
      this.votingEntries.delete(advanceId)
      this.setRecentValue(minDraftId)

      const challengerBody: BODY_ELECT_SEGMENT = {
        advanceOwner,
        advanceStamp,
        shardTag: body.shardTag,
        voter: this.myId,
        challenger: minDraftId
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
}

export class StageTwoTask {
  private realm: BaseRealm
  private syncQuorum: number
  private api: HyperClient
  private votingEntries: Map<string, StageTwoVotingEntry> = new Map()
  private recentValue: string = ''
  private timeoutMs: number

  constructor(sysRealm: BaseRealm, syncQuorum: number, options?: { timeoutMs?: number }) {
    this.realm = sysRealm
    this.syncQuorum = syncQuorum
    this.timeoutMs = options?.timeoutMs ?? STAGE_TWO_TIMEOUT_MS
    this.api = sysRealm.buildApi()

    this.api.subscribe(Event.ELECT_SEGMENT, this.event_elect_segment.bind(this))
  }

  listenStageOne(client: HyperClient) {
    client.pipe(this.api, Event.ELECT_SEGMENT, {exclude_me: false})
  }

  // Collect challenger IDs from all StageOne nodes, select maximum when quorum reached.
  // recentValue guards against out-of-order resolution.
  // Stale entries (quorum never reached) are evicted lazily on the next incoming vote.
  event_elect_segment(body: BODY_ELECT_SEGMENT) {
    const advanceOwner = body.advanceOwner
    const advanceStamp = body.advanceStamp
    const key = advanceOwner + ':' + advanceStamp

    if (body.challenger < this.recentValue) {
      console.log('=> Event.ELECT_SEGMENT skipped as applied:', body.challenger, '<', this.recentValue)
      return
    }

    console.log('=> Event.ELECT_SEGMENT', body)

    let entry = this.votingEntries.get(key)
    if (!entry) {
      entry = { maxChallenger: body.challenger, voters: new Set(), createdAt: Date.now() }
      this.votingEntries.set(key, entry)
    }

    // Lazy eviction: if a stale entry has been waiting too long without quorum,
    // discard it and notify the entry node so it can retry.
    if (Date.now() - entry.createdAt > this.timeoutMs) {
      this.votingEntries.delete(key)
      console.error(`StageTwoTask: Timeout for ${key} after ${entry.voters.size}/${this.syncQuorum} votes`)
      const failedMsg: BODY_ADVANCE_SEGMENT_FAILED = {
        advanceOwner,
        advanceStamp,
        reason: `StageTwoTask quorum timeout after ${entry.voters.size} votes`
      }
      this.api.publish(Event.ADVANCE_SEGMENT_FAILED, failedMsg, {})
      return
    }

    if (body.challenger > entry.maxChallenger) {
      entry.maxChallenger = body.challenger
    }
    entry.voters.add(body.voter)

    if (entry.voters.size >= this.syncQuorum) {
      const maxChallenger = entry.maxChallenger
      this.votingEntries.delete(key)

      // Advance recentValue for monotonic ordering
      if (maxChallenger > this.recentValue) {
        this.recentValue = maxChallenger
      }

      const msg: BODY_ADVANCE_SEGMENT_RESOLVED = {
        advanceStamp,
        advanceOwner: body.advanceOwner,
        segment: maxChallenger
      }
      this.api.publish(Event.ADVANCE_SEGMENT_RESOLVED, msg, {})
    }
  }
}
