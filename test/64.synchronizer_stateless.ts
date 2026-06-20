import * as chai from 'chai'; const { expect } = chai
import spies from 'chai-spies'
chai.use(spies)

import { Router } from '../lib/router'
import { StageOneTask, StageTwoTask } from '../lib/masterfree/synchronizer'
import { Event } from '../lib/masterfree/hyper.h'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'

describe('64.synchronizer_stateless', function () {
  let electStack: any[]
  let resolvedStack: any[]
  let failedStack: any[]
  let api: HyperClient
  let router: Router
  let sysRealm: BaseRealm
  let stageOne: StageOneTask
  let stageTwo: StageTwoTask
  const QUORUM = 2

  beforeEach(async () => {
    electStack = []
    resolvedStack = []
    failedStack = []
    router = new Router()
    router.setId('sync1')
    sysRealm = await router.getRealm('sys')
    api = sysRealm.buildApi()

    stageOne = new StageOneTask(sysRealm, 'SYNC1', QUORUM, ['SYNC2'])
    stageOne.reconcilePos('PREFIX1:', 0)
    stageTwo = new StageTwoTask(sysRealm, QUORUM)

    await api.subscribe(Event.ELECT_SEGMENT, (event) => { electStack.push(event) })
    await api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (event) => { resolvedStack.push(event) })
    await api.subscribe(Event.ADVANCE_SEGMENT_FAILED, (event) => { failedStack.push(event) })
  })

  // ─── StageOne ────────────────────────────────────────────────────────

  describe('StageOne: minimum draft selection', () => {

    it('selects minimum of two drafts when quorum reached', async () => {
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 'tag1' })
      // SYNC1 has draft id=1 → 'PREFIX1:a1', peer sync2 sends draft id=2 → 'PREFIX1:a2'
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 'tag1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 2 }
      })

      expect(electStack).to.have.lengthOf(1)
      expect(electStack[0].challenger).to.equal('PREFIX1:a1')  // min of a1, a2
      expect(electStack[0].voter).to.equal('SYNC1')
    })

    it('selects minimum even when peer draft arrives first', async () => {
      // Peer has lower draft than SYNC1
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 5, shardTag: 'tag5' })
      // SYNC1's id=1, peer sends id=0 (lower)
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 5, shardTag: 'tag5',
        draftOwner: 'SYNC2', draftId: { dt: 'AAA:', id: 1 }  // 'AAA:a1' < 'PREFIX1:a1'
      })

      expect(electStack).to.have.lengthOf(1)
      expect(electStack[0].challenger).to.equal('AAA:a1')  // min: AAA < PREFIX
    })

    it('deduplicates votes from the same draftOwner', async () => {
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 'tag1' })

      // Same voter votes twice — should not double-count
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 'tag1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 2 }
      })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 'tag1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 3 }
      })

      // Quorum reached only once, ELECT_SEGMENT published only once
      expect(electStack).to.have.lengthOf(1)
    })

    it('handles multiple parallel advanceIds independently', async () => {
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1' })
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2' })
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e2', advanceStamp: 1, shardTag: 't3' })

      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 10 }
      })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e2', advanceStamp: 1, shardTag: 't3',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 20 }
      })

      // Only e1:2 and e2:1 reached quorum, e1:1 still waiting
      expect(electStack).to.have.lengthOf(2)
      const ids = electStack.map(e => `${e.advanceOwner}:${e.advanceStamp}`)
      expect(ids).to.include.members(['e1:2', 'e2:1'])
      expect(ids).to.not.include('e1:1')
    })

    it('does not republish ELECT_SEGMENT for already-resolved advanceId', async () => {
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1' })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 2 }
      })
      expect(electStack).to.have.lengthOf(1)

      // Late arrival for the same advanceId
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        draftOwner: 'SYNC3', draftId: { dt: 'PREFIX1:', id: 3 }
      })

      // Still only one ELECT_SEGMENT — single late vote can't reach quorum=2 alone
      expect(electStack).to.have.lengthOf(1)
    })

    it('advances recentValue monotonically after each quorum', async () => {
      expect(stageOne.getRecentValue()).to.equal('')

      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1' })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 5 }
      })
      const after1 = stageOne.getRecentValue()

      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2' })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 10 }
      })
      const after2 = stageOne.getRecentValue()

      expect(after2 >= after1).to.be.true
    })
  })

  // ─── StageTwo ────────────────────────────────────────────────────────

  describe('StageTwoTask: maximum challenger selection', () => {
    it('resolves with maximum challenger when quorum reached', async () => {
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        voter: 'SYNC1', challenger: 'PREFIX1:a1'
      })
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        voter: 'SYNC2', challenger: 'PREFIX1:a3'  // higher
      })

      expect(resolvedStack).to.have.lengthOf(1)
      expect(resolvedStack[0].segment).to.equal('PREFIX1:a3')  // max of a1, a3
      expect(resolvedStack[0].advanceOwner).to.equal('e1')
      expect(resolvedStack[0].advanceStamp).to.equal(1)
    })

    it('deduplicates votes from the same voter', async () => {
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        voter: 'SYNC1', challenger: 'PREFIX1:a1'
      })
      // Same voter again
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1',
        voter: 'SYNC1', challenger: 'PREFIX1:a5'
      })

      // Quorum not reached — only 1 unique voter
      expect(resolvedStack).to.have.lengthOf(0)
    })

    it('skips challenger below recentValue (monotonic guard)', async () => {
      // First resolution sets recentValue
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC1', challenger: 'ZZZ:a9' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC2', challenger: 'ZZZ:a9' })
      expect(resolvedStack).to.have.lengthOf(1)

      // Late arrival with lower ID — should be skipped
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e2', advanceStamp: 1, shardTag: 't2', voter: 'SYNC1', challenger: 'AAA:a1' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e2', advanceStamp: 1, shardTag: 't2', voter: 'SYNC2', challenger: 'AAA:a1' })

      // Second should be skipped due to recentValue guard
      expect(resolvedStack).to.have.lengthOf(1)
    })

    it('does not re-resolve an already-resolved advanceId', async () => {
      // Reach quorum
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC1', challenger: 'PREFIX1:a1' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC2', challenger: 'PREFIX1:a2' })
      expect(resolvedStack).to.have.lengthOf(1)

      // Late third vote for the same advanceId
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC3', challenger: 'PREFIX1:a9' })

      // Still only one resolution
      expect(resolvedStack).to.have.lengthOf(1)
      expect(resolvedStack[0].segment).to.equal('PREFIX1:a2')
    })

    it('handles multiple parallel advanceIds independently', async () => {
      // e1:1
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC1', challenger: 'PREFIX1:a1' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC2', challenger: 'PREFIX1:a2' })
      // e1:2
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2', voter: 'SYNC1', challenger: 'PREFIX1:a3' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 2, shardTag: 't2', voter: 'SYNC2', challenger: 'PREFIX1:a4' })

      expect(resolvedStack).to.have.lengthOf(2)
      expect(resolvedStack[0].segment).to.equal('PREFIX1:a2')
      expect(resolvedStack[1].segment).to.equal('PREFIX1:a4')
    })
  })

  // ─── StageOne + StageTwo integration ─────────────────────────────────

  describe('Integration: StageOne → StageTwo full flow', () => {
    it('full two-stage consensus produces ADVANCE_SEGMENT_RESOLVED', async () => {
      // stageOne and stageTwo share sysRealm — stageTwo is already subscribed to ELECT_SEGMENT
      // StageOne: SYNC1 self-vote + SYNC2 peer vote → reaches quorum=2, publishes ELECT_SEGMENT
      await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1' })
      await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {
        advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1',
        draftOwner: 'SYNC2', draftId: { dt: 'PREFIX1:', id: 5 }
      })

      // StageOne has published ELECT_SEGMENT (voter=SYNC1) — stageTwo already received it
      // Need second voter for stageTwo quorum=2
      const firstChallenger = electStack[0]?.challenger ?? 'PREFIX1:a1'
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1',
        voter: 'SYNC2', challenger: firstChallenger
      })

      expect(resolvedStack).to.have.lengthOf(1)
      expect(resolvedStack[0].advanceOwner).to.equal('entry1')
      expect(resolvedStack[0].advanceStamp).to.equal(1)
      expect(resolvedStack[0].segment).to.equal(firstChallenger)
    })

    it('publishes ADVANCE_SEGMENT_FAILED on StageTwo timeout', async function (this: Mocha.Context) {
      this.timeout(5000)

      const stageTwoFast = new StageTwoTask(sysRealm, 2, { timeoutMs: 100 })
      ;(stageTwoFast as any).votingEntries.set('e1:99', {
        maxChallenger: 'PREFIX1:a1',
        voters: new Set(['SYNC1']),
        createdAt: Date.now() - 200  // 200ms ago — past 100ms timeout
      })

      // Trigger timeout check by sending a new vote
      await api.publish(Event.ELECT_SEGMENT, {
        advanceOwner: 'e1', advanceStamp: 99, shardTag: 'tag99',
        voter: 'SYNC2', challenger: 'PREFIX1:a2'
      })

      expect(failedStack).to.have.lengthOf(1)
      expect(failedStack[0].advanceOwner).to.equal('e1')
      expect(failedStack[0].advanceStamp).to.equal(99)
      expect(failedStack[0].reason).to.include('timeout')
    })
  })

  // ─── Monotonic ordering ───────────────────────────────────────────────

  describe('Monotonic ordering', () => {
    it('consecutive segments produce non-decreasing IDs', async () => {
      const segments = [1, 2, 3, 4, 5]
      for (const seg of segments) {
        await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: seg, shardTag: `t${seg}`, voter: 'SYNC1', challenger: `PREFIX1:a${seg}` })
        await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: seg, shardTag: `t${seg}`, voter: 'SYNC2', challenger: `PREFIX1:a${seg}` })
      }

      expect(resolvedStack).to.have.lengthOf(5)
      for (let i = 1; i < resolvedStack.length; i++) {
        expect(resolvedStack[i].segment >= resolvedStack[i - 1].segment).to.be.true
      }
    })

    it('out-of-order challenger below recentValue is skipped', async () => {
      // High segment first
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC1', challenger: 'ZZZ:z9' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e1', advanceStamp: 1, shardTag: 't1', voter: 'SYNC2', challenger: 'ZZZ:z9' })

      // Then lower challenger
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e2', advanceStamp: 1, shardTag: 't2', voter: 'SYNC1', challenger: 'AAA:a1' })
      await api.publish(Event.ELECT_SEGMENT, { advanceOwner: 'e2', advanceStamp: 1, shardTag: 't2', voter: 'SYNC2', challenger: 'AAA:a1' })

      expect(resolvedStack).to.have.lengthOf(1)
      expect(resolvedStack[0].segment).to.equal('ZZZ:z9')
    })
  })
})
