import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { DbFactory } from '../lib/sqlite/dbfactory'
import { ProduceId } from '../lib/masterfree/makeid'
import { SqliteKvFabric, createKvTables } from '../lib/sqlite/sqlitekv'

describe('35.update_history', function () {
  let db: sqlite.Database
  let dbFactory: DbFactory
  let makeId: ProduceId
  let kvFabric: SqliteKvFabric
  const realmName = 'testrealm'

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    dbFactory = new DbFactory(':memory:')
    dbFactory.setMainDb(db)
    // Stub getDb to always return our in-memory DB for testrealm
    dbFactory.getDb = async (name) => db
    
    makeId = new ProduceId(() => '202605301200')
    makeId.actualizePrefix()
    
    kvFabric = new SqliteKvFabric(dbFactory, makeId)
    await createKvTables(db, realmName)
  })

  it('records history for KV create', async () => {
    await kvFabric.setKeyValue(realmName, 'key.1', 'msg1', { kv: { a: 1 } }, {}, 'sid1', () => {})
    
    const history = await db.all(`SELECT * FROM update_history_${realmName}`)
    expect(history).to.have.lengthOf(1)
    expect(history[0].entity_type).to.equal('kv')
    expect(history[0].entity_uri).to.equal('key.1')
    expect(history[0].old_updated_by_msg_id).to.be.null
    expect(history[0].msg_oldv).to.be.null
    expect(JSON.parse(history[0].msg_newv)).to.deep.equal({ kv: { a: 1 } })

    const kv = await db.get(`SELECT updated_by_msg_id FROM kv_${realmName} WHERE key = 'key.1'`)
    expect(kv.updated_by_msg_id).to.equal(history[0].msg_id)
  })

  it('records history for KV update', async () => {
    await kvFabric.setKeyValue(realmName, 'key.1', 'msg1', { kv: { a: 1 } }, {}, 'sid1', () => {})
    const kv1 = await db.get(`SELECT updated_by_msg_id FROM kv_${realmName} WHERE key = 'key.1'`)
    
    await kvFabric.setKeyValue(realmName, 'key.1', 'msg2', { kv: { a: 2 } }, {}, 'sid1', () => {})
    
    const history = await db.all(`SELECT * FROM update_history_${realmName} ORDER BY msg_id ASC`)
    expect(history).to.have.lengthOf(2)
    expect(history[1].old_updated_by_msg_id).to.equal(kv1.updated_by_msg_id)
    expect(JSON.parse(history[1].msg_oldv)).to.deep.equal({ kv: { a: 1 } })
    expect(JSON.parse(history[1].msg_newv)).to.deep.equal({ kv: { a: 2 } })
  })

  it('records history for KV delete', async () => {
    await kvFabric.setKeyValue(realmName, 'key.1', 'msg1', { kv: { a: 1 } }, {}, 'sid1', () => {})
    const kv1 = await db.get(`SELECT updated_by_msg_id FROM kv_${realmName} WHERE key = 'key.1'`)
    
    await kvFabric.setKeyValue(realmName, 'key.1', 'msg2', { kv: null }, {}, 'sid1', () => {})
    
    const history = await db.all(`SELECT * FROM update_history_${realmName} ORDER BY msg_id ASC`)
    expect(history).to.have.lengthOf(2)
    expect(history[1].old_updated_by_msg_id).to.equal(kv1.updated_by_msg_id)
    expect(JSON.parse(history[1].msg_oldv)).to.deep.equal({ kv: { a: 1 } })
    expect(history[1].msg_newv).to.be.null
  })

  it('records history for session-persistent KV updates with original msg_id', async () => {
    await kvFabric.setKeyValue(realmName, 'key.will', 'msg-orig', { kv: { a: 1 } }, { will: { kv: { a: 'will' } } }, 'sid-client', () => {})
    const kvOrig = await db.get(`SELECT updated_by_msg_id FROM kv_${realmName} WHERE key = 'key.will'`)
    
    // Clear history from initial 'create' (the 'val-orig' part)
    await db.run(`DELETE FROM update_history_${realmName}`)
    
    // Simulate session cleanup (application of 'will' message)
    await kvFabric.eraseSessionData(realmName, 'sid-client', (sid, key, will) => {
        // This is what BaseRealm.runInboundEvent does
        return kvFabric.setKeyValue(realmName, key.join('.'), 'new-msg-id', will, {}, sid, () => {}, {
            getEventId: () => 'new-msg-id',
            // mock other ActorPush methods
            getUri: () => key,
            getData: () => will,
            getOpt: () => ({}),
            getSid: () => sid,
            confirm: () => {},
            isActive: () => true,
            rejectCmd: () => {}
        } as any)
    })
    
    const history = await db.all(`SELECT * FROM update_history_${realmName}`)
    expect(history).to.have.lengthOf(1)
    expect(history[0].entity_uri).to.equal('key.will')
    expect(history[0].old_updated_by_msg_id).to.equal(kvOrig.updated_by_msg_id)
    expect(JSON.parse(history[0].msg_newv)).to.deep.equal({ kv: { a: 'will' } })
  })
})
