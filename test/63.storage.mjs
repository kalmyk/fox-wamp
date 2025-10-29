import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import Router from '../lib/router.js'
import { StorageTask } from '../lib/masterfree/storage'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { Event } from '../lib/masterfree/hyper.h'

describe('63.storage', function () {
  let
    draftStack,
    extractStack,
    api,
    router,
    sysRealm,
    storage

  beforeEach(async () => {
    const db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    const dbFactory = new DbFactory()
    dbFactory.setMainDb(db)

    draftStack = []
    extractStack = []
    router = new Router()
    router.setId('sync1')
    sysRealm = await router.getRealm('sys')

    storage = new StorageTask(
      sysRealm,
      dbFactory
    )

    api = sysRealm.buildApi()
    await api.subscribe(Event.PICK_CHALLENGER, (event, opt) => { draftStack.push(opt.headers) })
    await api.subscribe(Event.ELECT_SEGMENT, (event, opt) => { extractStack.push(opt.headers) })
  })

  afterEach(async () => {})

  it('receive draft segment', async () => {
    // await api.publish(Event.PICK_CHALLENGER, null, {
    //   headers: {
    //     advanceOwner: 'entry1',
    //     advanceSegment: 'a0',
    //     draftOwner: 'sync2',
    //     draftId: { dt: 'PREFIX1:', id: 1 }
    //   }
    // })

    // expect(draftStack).deep.equal([{
    //   advanceOwner: 'entry1',
    //   advanceSegment: 'a0',
    //   draftId: { dt: 'PREFIX1:', id: 1 },
    //   draftOwner: 'sync2'
    // }])

    // expect(extractStack).deep.equal([])
  })

})
