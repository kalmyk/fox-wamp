import { once } from 'node:events'

import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import Router from '../lib/router.js'
import { StorageTask, COMMIT_COMPLETED } from '../lib/masterfree/storage.js'
import { DbFactory } from '../lib/sqlite/dbfactory.js'
import { Event, BODY_ADVANCE_SEGMENT_RESOLVED } from '../lib/masterfree/hyper.h.js'
import { BaseRealm } from '../lib/realm.js'
import { HyperClient } from '../lib/hyper/client.js'

describe('63.storage', function () {
  let
    draftStack: any[],
    extractStack: any[],
    api: HyperClient,
    router: Router,
    sysRealm: BaseRealm,
    storage: StorageTask,
    dbFactory: DbFactory,
    db: sqlite.Database

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    dbFactory = new DbFactory('/tmp/fox-test-dbs/')
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

  it('receive-draft-segment', async () => {
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

  /*
    send data events with draft id
    commit - replace draft id with resolved segment id
    verify saved data in db
  */
  it('listen-commit-checkDb', async () => {
    // 1. Send KEEP_ADVANCE_HISTORY
    await api.publish(Event.KEEP_ADVANCE_HISTORY, {
      advanceId: { segment: 'seg1', offset: 1 },
      shard: 0,
      realm: 'myrealm',
      data: 'test-data',
      uri: ['my', 'topic'],
      opt: { trace: true },
      sid: 'session1'
    }, { exclude_me: false })

    const commit_requested: Promise<any[]> = once(storage, COMMIT_COMPLETED)
    
    // 2. Send ADVANCE_SEGMENT_RESOLVED
    await api.publish(Event.ADVANCE_SEGMENT_RESOLVED, {
      advanceOwner: 'sync1',
      advanceSegment: 'seg1',
      segment: 'res_seg1'
    }, { exclude_me: false })

    const commit_resolverd: any[] = await commit_requested
    const commit_result: BODY_ADVANCE_SEGMENT_RESOLVED = commit_resolverd[0]

    expect(commit_result).to.deep.equal({
      advanceOwner: 'sync1',
      advanceSegment: 'seg1',
      segment: 'res_seg1'
    })

    // 3. Check Database
    const rows = await db.all("SELECT * FROM event_history_myrealm")
    expect(rows).to.have.lengthOf(1)
    expect(rows[0].msg_id).to.equal('res_seg1a1')
    expect(rows[0].msg_shard).to.equal(0)
    expect(rows[0].msg_uri).to.equal('my.topic')
    expect(rows[0].msg_body).to.equal('"test-data"')
    expect(JSON.parse(rows[0].msg_opt)).to.deep.equal({ trace: true })
  })

})
