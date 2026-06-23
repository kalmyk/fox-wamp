import * as chai from 'chai'
import promised from 'chai-as-promised'
const assert: Chai.AssertStatic = chai.assert
const { expect } = chai
chai.use(promised)
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'
import { promises as fsp } from 'fs'
import os from 'os'
import path from 'path'

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { DbEngine, SqliteKv } from '../lib/sqlite/dbengine'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { SqliteKvFabric } from '../lib/sqlite/sqlitekv'
import { ProduceId } from '../lib/masterfree/makeid'
import { HyperClient } from '../lib/hyper/client'
import { getBodyValue } from '../lib/base_gate'

const TEST_REALM_NAME = 'testrealm'

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

const openDb = async (filename = ':memory:'): Promise<sqlite.Database> => sqlite.open({
  filename,
  driver: sqlite3.Database
})

const makeRealm = async (router: Router, db: sqlite.Database, idPrefix = 'session-kv-test-'): Promise<BaseRealm> => {
  const dbFactory = new DbFactory('/tmp/test-fox-wamp.db')
  dbFactory.setMainDb(db)
  const makeId = new ProduceId(() => idPrefix)
  makeId.actualizePrefix()
  const modKv = new SqliteKvFabric(dbFactory, makeId)
  const engine = new DbEngine(makeId, modKv)
  const realm = new BaseRealm(router, engine)
  realm.registerKeyValueEngine(['#'], new SqliteKv(modKv, TEST_REALM_NAME, engine))
  await router.initRealm(TEST_REALM_NAME, realm)
  return realm
}

const getStoredBody = async (realm: BaseRealm, uri: string[]): Promise<any> => {
  const values: any[] = []
  await realm.getKey(uri, (key, data) => values.push(getBodyValue(data)))
  return values.length === 0 ? null : values[0]
}

describe('34.session-kv-single-db', () => {
  let db: sqlite.Database
  let router: Router
  let realm: BaseRealm
  let api: HyperClient

  beforeEach(async () => {
    db = await openDb()
    router = new Router()
    realm = await makeRealm(router, db)
    api = realm.api() as HyperClient
  })

  afterEach(async () => {
    if (api) {
      assert.isFalse(api.session().hasSendError(), api.session().firstSendErrorMessage())
      await api.session().cleanup()
    }
    if (db) {
      await db.close()
    }
  })

  it('registers will updates with debug message id', async () => {
    const client = realm.buildApi()
    try {
      const eventId = await client.publish('session.debug', { status: 'active' }, {
        retain: true,
        acknowledge: true,
        will: { status: 'offline' }
      })

      const row = await db.get(
        `SELECT topic, value, will_sid, msg_id FROM session_kv_${TEST_REALM_NAME} WHERE topic = ?`,
        ['session.debug']
      )
      expect(row.topic).equal('session.debug')
      expect(JSON.parse(row.value)).deep.equal({ status: 'offline' })
      expect(row.will_sid).equal(client.session().getSid())
      expect(row.msg_id).equal(eventId)
    } finally {
      await client.session().cleanup()
    }
  })

  it('applies registered will updates when the session is cleaned up', async () => {
    const client = realm.buildApi()
    await client.publish('session.will', { status: 'active' }, {
      retain: true,
      acknowledge: true,
      will: { status: 'offline' }
    })

    await client.session().cleanup()

    expect(await getStoredBody(realm, ['session', 'will'])).deep.equal({ status: 'offline' })
    const row = await db.get(`SELECT topic FROM session_kv_${TEST_REALM_NAME} WHERE topic = ?`, ['session.will'])
    expect(row).equal(undefined)
  })

  it('blocks failed conditional updates and releases watch updates when the condition matches', async () => {
    await api.publish('session.watch', { status: 'busy' }, {
      retain: true,
      acknowledge: true
    })

    await assert.isRejected(
      api.publish('session.watch', { owner: 'no-watch' }, {
        retain: true,
        acknowledge: true,
        when: null
      }),
      'not accepted'
    )

    let watchResolved = false
    const watchPromise = api.publish('session.watch', { owner: 'watcher' }, {
      retain: true,
      acknowledge: true,
      when: null,
      watch: true
    }).then(() => {
      watchResolved = true
    })

    await sleep(5)
    expect(watchResolved).equal(false)

    await api.publish('session.watch', null, {
      retain: true,
      acknowledge: true
    })

    await watchPromise
    expect(await getStoredBody(realm, ['session', 'watch'])).deep.equal({ owner: 'watcher' })
  })

  it('applies multiple keys registered by the same session', async () => {
    const client = realm.buildApi()
    await client.publish('session.multi.one', { status: 'active-1' }, {
      retain: true,
      acknowledge: true,
      will: { status: 'offline-1' }
    })
    await client.publish('session.multi.two', { status: 'active-2' }, {
      retain: true,
      acknowledge: true,
      will: { status: 'offline-2' }
    })

    await client.session().cleanup()

    expect(await getStoredBody(realm, ['session', 'multi', 'one'])).deep.equal({ status: 'offline-1' })
    expect(await getStoredBody(realm, ['session', 'multi', 'two'])).deep.equal({ status: 'offline-2' })
  })

  it('applies stale session records on restart', async () => {
    const filename = path.join(os.tmpdir(), `fox-wamp-session-kv-${Date.now()}-${Math.random()}.sqlite`)
    let firstDb = await openDb(filename)
    try {
      const firstRouter = new Router()
      const firstRealm = await makeRealm(firstRouter, firstDb, 'session-kv-first-')
      const firstApi = firstRealm.buildApi()

      await firstApi.publish('session.restart', { status: 'active' }, {
        retain: true,
        acknowledge: true,
        will: { status: 'offline-after-restart' }
      })
      await firstDb.close()

      const secondDb = await openDb(filename)
      const secondRouter = new Router()
      const secondRealm = await makeRealm(secondRouter, secondDb, 'session-kv-second-')

      expect(await getStoredBody(secondRealm, ['session', 'restart'])).deep.equal({ status: 'offline-after-restart' })
      const row = await secondDb.get(`SELECT topic FROM session_kv_${TEST_REALM_NAME} WHERE topic = ?`, ['session.restart'])
      expect(row).equal(undefined)
      await secondDb.close()
    } finally {
      await fsp.rm(filename, { force: true })
    }
  })

  it('drops the legacy set_value table during schema initialization', async () => {
    const legacyDb = await openDb()
    try {
      await legacyDb.run(`CREATE TABLE set_value_${TEST_REALM_NAME} (topic TEXT)`)
      const legacyRouter = new Router()
      await makeRealm(legacyRouter, legacyDb)

      const row = await legacyDb.get(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
        [`set_value_${TEST_REALM_NAME}`]
      )
      expect(row).equal(undefined)
    } finally {
      await legacyDb.close()
    }
  })
})
