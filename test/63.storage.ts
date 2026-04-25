import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import Router from '../lib/router.js'
import { StorageTask } from '../lib/masterfree/storage.js'
import { DbFactory } from '../lib/sqlite/dbfactory.js'
import { Event } from '../lib/masterfree/hyper.h.js'
import { BaseRealm } from '../lib/realm.js'
import { HyperClient } from '../lib/hyper/client.js'

describe('63.storage', function () {
  let
    draftStack: any[],
    extractStack: any[],
    api: HyperClient,
    router: Router,
    sysRealm: BaseRealm,
    storage: StorageTask

  beforeEach(async () => {
    const db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    const dbFactory = new DbFactory('/tmp/fox-test-dbs/')
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
