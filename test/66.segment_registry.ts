import { once } from 'node:events'
import { crc32 } from 'zlib'
import * as chai from 'chai'; const { expect } = chai

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { Router } from '../lib/router'
import { EventStorageTask, SEGMENT_COMMITTED } from '../lib/masterfree/storage'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { BaseRealm } from '../lib/realm'
import { Event, BODY_KEEP_ADVANCE_HISTORY, BODY_ADVANCE_SEGMENT_RESOLVED, BODY_ADVANCE_SEGMENT_OVER } from '../lib/masterfree/hyper.h'
import { computeUriCrc } from '../lib/sqlite/segment_registry'
import { restoreUri } from '../lib/topic_pattern'
import { HyperClient } from '../lib/hyper/client'

describe('66.segment_registry', function () {

  // ─── unit: computeUriCrc ────────────────────────────────────────────

  describe('computeUriCrc', () => {
    it('5.1 returns 0 for empty array', () => {
      expect(computeUriCrc([])).to.equal(0)
    })

    it('5.2 sums CRC32 over per-event URIs', () => {
      const events: BODY_KEEP_ADVANCE_HISTORY[] = [
        { advanceOwner: 'e1', advanceId: { segment: 1, offset: 1 }, shard: 0, realm: 'r', data: '', uri: ['a', 'b'], opt: {}, sid: '' },
        { advanceOwner: 'e1', advanceId: { segment: 1, offset: 2 }, shard: 0, realm: 'r', data: '', uri: ['c', 'd'], opt: {}, sid: '' },
      ]
      const expected = crc32(restoreUri(['a', 'b'])) + crc32(restoreUri(['c', 'd']))
      expect(computeUriCrc(events)).to.equal(expected)
    })
  })

  // ─── integration: segment_registry lifecycle ────────────────────────

  describe('segment_registry lifecycle', () => {
    let router: Router
    let sysRealm: BaseRealm
    let dbFactory: DbFactory
    let db: sqlite.Database
    let api: HyperClient

    beforeEach(async () => {
      db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
      dbFactory = new DbFactory('/tmp/fox-test-dbs/')
      dbFactory.setMainDb(db)
      router = new Router()
      router.setId('NDB1')
      sysRealm = await router.getRealm('sys')
      api = sysRealm.buildApi()
      new EventStorageTask(sysRealm, dbFactory, { shards: [0] })
    })

    const kah: BODY_KEEP_ADVANCE_HISTORY = {
      advanceOwner: 'entry1',
      advanceId: { segment: 1, offset: 1 },
      shard: 0,
      realm: 'myrealm',
      data: 'test-data',
      uri: ['my', 'topic'],
      opt: {},
      sid: 'sid1'
    }

    const over: BODY_ADVANCE_SEGMENT_OVER = {
      advanceOwner: 'entry1',
      advanceStamp: 1,
      shardTag: 0,
      totalEvents: 1
    }

    const resolved: BODY_ADVANCE_SEGMENT_RESOLVED = {
      advanceOwner: 'entry1',
      advanceStamp: 1,
      segment: 'seg1'
    }

    it('5.4 ADVANCE_SEGMENT_OVER inserts row with status=over', async () => {
      await api.publish(Event.keepAdvanceHistoryTopic(0), kah, { exclude_me: false })
      await api.publish(Event.ADVANCE_SEGMENT_OVER, over, { exclude_me: false })
      await new Promise(r => setTimeout(r, 20))

      const rows = await db.all('SELECT * FROM segment_registry_myrealm')
      expect(rows).to.have.lengthOf(1)
      expect(rows[0].advance_owner).to.equal('entry1')
      expect(rows[0].advance_stamp).to.equal(1)
      expect(rows[0].shard_tag).to.equal(0)
      expect(rows[0].status).to.equal('over')
      expect(rows[0].segment_id).to.be.null
    })

    it('5.3 ADVANCE_SEGMENT_RESOLVED finalises row with status=resolved', async () => {
      const committed = once(dbFactory, SEGMENT_COMMITTED)

      await api.publish(Event.keepAdvanceHistoryTopic(0), kah, { exclude_me: false })
      await api.publish(Event.ADVANCE_SEGMENT_OVER, over, { exclude_me: false })
      await api.publish(Event.ADVANCE_SEGMENT_RESOLVED, resolved, { exclude_me: false })

      await committed

      const rows = await db.all('SELECT * FROM segment_registry_myrealm')
      expect(rows).to.have.lengthOf(1)
      expect(rows[0].status).to.equal('resolved')
      expect(rows[0].segment_id).to.equal('seg1')
      expect(rows[0].msg_count).to.equal(1)
      expect(rows[0].crc32).to.be.a('number').and.greaterThan(0)
    })
  })
})
