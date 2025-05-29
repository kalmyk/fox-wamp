'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
chai.use(spies)

const Router         = require('../lib/router')
const { StorageTask } = require('../lib/masterfree/storage')

describe('63 storage', function () {
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

    await api.subscribe('draftSegment', (event, opt) => { draftStack.push(opt.headers) })

    const MAJOR_LIMIT = 2
    storage = new StorageTask(sysRealm)
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

})
