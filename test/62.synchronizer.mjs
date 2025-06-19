import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import Router       from '../lib/router'
import { EVENT_DRAFT_SEGMENT } from '../lib/masterfree/synchronizer.h'
import { StageOneTask } from '../lib/masterfree/synchronizer'

describe('62 synchronizer', function () {
  let
    draftStack,
    extractStack,
    api,
    router,
    sysRealm,
    stageOne

  beforeEach(async () => {
    draftStack = []
    extractStack = []
    router = new Router()
    router.setId('sync1')
    sysRealm = await router.getRealm('sys')
    api = sysRealm.buildApi()

    await api.subscribe(EVENT_DRAFT_SEGMENT, (event, opt) => { draftStack.push(opt.headers) })

    const MAJOR_LIMIT = 2
    stageOne = new StageOneTask(sysRealm, MAJOR_LIMIT)
    stageOne.reconcilePos('PREFIX1:')
    await api.subscribe('challengerExtract', (event, opt) => { extractStack.push(opt.headers) })
  })

  afterEach(async () => {})
  
  it('init-seed generateOnce', async () => {
    await api.publish('generateSegment', null, {headers:{advanceOwner:'entry1', advanceSegment:'a0'}})
    await api.publish('generateSegment', null, {headers:{advanceOwner:'entry1', advanceSegment:'a0'}})

    expect(draftStack).deep.equal([{
      advanceOwner: 'entry1',
      advanceSegment: 'a0',
      draftId: { dt: 'PREFIX1:', id: 1 },
      draftOwner: 'sync1'
    }])

    expect(stageOne.getRecentValue()).deep.equal('')
    expect(extractStack).deep.equal([])
  })

  // it('stage-one extractDraft gen-here', async () => {
  //   expect(stageOne.getRecentValue()).deep.equal('')
  //   stageOne.setRecentValue('P:1')

  //   await api.publish('generateSegment', null, {headers:{advanceOwner:'entry1', advanceSegment:'a1'}})

  //   await api.publish(EVENT_DRAFT_SEGMENT, null, {headers: {advanceOwner: 'entry1', advanceSegment: 'a1', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 2 }}})
  //   await api.publish(EVENT_DRAFT_SEGMENT, null, {headers: {advanceOwner: 'entry1', advanceSegment: 'a2', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 3 }}})

  //   expect(extractStack).deep.equal([])
  //   expect(stageOne.getRecentValue()).equal('P:1')
  //   expect(stageOne.extractDraft()).equal('a1')
  // })

  // it('stage-one extract', async () => {
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic1', 'a1')
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic2', 'a1')

  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic2', 'a2')
  //   assert.deepEqual(extractHistory.shift(), ['topic2','a1'])
  //   assert.equal(stageOne.getRecentValue(), 'a1')

  //   // vote for closed topic
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter3', 'topic2', 'a3')
  //   assert.equal(extractHistory.shift(), undefined)
  //   assert.equal(stageOne.getRecentValue(), 'a2')

  //   // value is taken from recent vote
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic1', 'a2')
  //   assert.deepEqual(extractHistory.shift(), ['topic1','a3'])
  //   assert.equal(stageOne.getRecentValue(), 'a3')
  // })

})
