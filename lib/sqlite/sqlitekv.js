'use strict'

const { match, restoreUri, defaultParse } = require('../topic_pattern')
const { KeyValueStorageAbstract, isDataEmpty, deepDataMerge, unSerializeData, makeDataSerializable } = require('../realm')
const { KPQueue } = require('../allot/kpqueue')
const { getDbFactoryInstance } = require('./dbfactory')

async function createKvTables (db, realmName) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS update_history_${realmName} (
      msg_id TEXT not null,
      msg_origin TEXT not null,
      msg_uri TEXT not null,
      msg_oldv TEXT,
      PRIMARY KEY (msg_id));`
  )
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_${realmName} (
      key TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      opt TEXT not null,
      stamp TEXT,
      PRIMARY KEY (key));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS kv_sid_${realmName} on kv_${realmName} (will_sid);`
  )
  await db.run(
    `CREATE TABLE IF NOT EXISTS set_value_${realmName} (
      key TEXT not null,
      msg_id TEXT not null,
      will_sid TEXT not null,
      set_when TEXT not null,
      PRIMARY KEY (key, msg_id));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS set_value_sid_${realmName} on set_value_${realmName} (will_sid);`
  )
}

async function saveUpdateHistory (db, realmName, id, origin, suri, oldv, newv) {
  return db.run(
    `INSERT INTO update_history_${realmName} VALUES (?,?,?,?);`,
    [id, origin, suri, JSON.stringify(oldv)]
  )
}

class SqliteModKv {
  constructor () {
    this.db = getDbFactoryInstance().getMainDb()
    this.pkq = new KPQueue()
  }

  async eraseSessionData (realmName, sessionId, runInboundEvent) {
    const toRemove = []
    await this.db.each(
      `SELECT key, opt FROM kv_${realmName} WHERE will_sid = ?`,
      [sessionId],
      (err, row) => {
        toRemove.push({key: row.key, opt: JSON.parse(row.opt)})
      }
    )
    for (let row of toRemove) {
      if (row.opt.will) {
        runInboundEvent(sessionId, defaultParse(row.key), row.opt.will)
      } else {
        runInboundEvent(sessionId, defaultParse(row.key), null)
      }
    }
    // erase is expected to be done by incoming message
    // await this.db.run(
    //   `DELETE FROM kv_${realmName} WHERE will_sid = ?`,
    //   [realmName, sessionId]
    // )

    await this.db.run(
      `DELETE FROM set_value_${realmName} WHERE will_sid = ?`,
      [sessionId]
    )
  }

  // @return promise
  setKeyValue (realmName, suri, makeId, origin, data, opt, sid, pubOutEvent) {
    return this.pkq.enQueue(realmName + '|' + suri, async () => {
      const willSid = ('will' in opt) ? sid : 0
  
      try {
        const oldRow = await this.db.get(
          `SELECT value, opt FROM kv_${realmName} WHERE key = ?`,
          [suri]
        )
        const oldData = oldRow && oldRow.value ? unSerializeData(JSON.parse(oldRow.value)) : null
        const newData = deepDataMerge(oldData, data)

        const updateHistoryId = makeId.generateIdStr()
        if (isDataEmpty(newData)) {
          await this.db.run(`DELETE FROM kv_${realmName} WHERE key = ?`, [suri])
        } else {
          await this.db.run(
            `INSERT OR REPLACE INTO kv_${realmName} (key, value, will_sid, opt, stamp) VALUES (?, ?, ?, ?, ?)`,
            [suri, JSON.stringify(makeDataSerializable(newData)), willSid, JSON.stringify(opt), updateHistoryId]
          )
        }
        saveUpdateHistory(this.db, realmName, origin, updateHistoryId, suri, makeDataSerializable(oldData))
        pubOutEvent('event', { sid, oldData, newData })
      } catch (e) {
        console.log('SetKeyValue ERROR:', e.message, e.stack)
      }
    })
  }

  async applySegment(segment, pubOutEvent) {
    for (let inEvent of segment) {
      console.log("MOD-KV", inEvent)
      if (inEvent.opt.trace) {
        await this.setKeyValue(
          inEvent.realm,
          restoreUri(inEvent.uri),
          this.makeId(),
          inEvent.qid,
          inEvent.data,
          inEvent.opt,
          inEvent.sid,
          pubOutEvent
        )
      }
    }
  }

  getKey (realmName, uri, cbRow) {
    const strUri = restoreUri(uri)
    return this.pkq.enQueue(realmName + '|' + strUri, async () => {
      // TODO: optimize search
      await this.db.each(
        `SELECT key, value, opt, stamp FROM kv_${realmName}`,
        [],
        (err, row) => {
          const aKey = defaultParse(row.key)
          if (match(aKey, uri)) {
            const rowData = JSON.parse(row.value)
            cbRow(aKey, unSerializeData(rowData), row.stamp)
          }
        }
      )
    })
  }
}

class SqliteKv extends KeyValueStorageAbstract {
  constructor (mod, makeId, realmName) {
    super()
    this.mod = mod
    this.makeId = makeId
    this.realmName = realmName
  }
    
  eraseSessionData (sessionId) {
    return this.mod.eraseSessionData (this.realmName, sessionId, this.runInboundEvent.bind(this))
  }

  // @result promise
  setKeyActor (actor) {
    const suri = this.getStrUri(actor)
    return this.mod.setKeyValue(
      this.realmName,
      suri,
      this.makeId,
      actor.getEventId(),
      actor.getData(),
      actor.getOpt(),
      actor.getSid(),
      (kind, outEvent) => actor.confirm(actor.msg)
    )
  }

  // @return promise
  getKey (uri, cbRow) {
    return this.mod.getKey(this.realmName, uri, cbRow)
  }
}

exports.createKvTables = createKvTables
exports.saveUpdateHistory = saveUpdateHistory
exports.SqliteKv = SqliteKv
exports.SqliteModKv = SqliteModKv
