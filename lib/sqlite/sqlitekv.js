'use strict'

const { match, restoreUri, defaultParse } = require('../topic_pattern')
const { KeyValueStorageAbstract, isDataEmpty, deepDataMerge, unSerializeData, makeDataSerializable } = require('../realm')
const { KPQueue } = require('../allot/kpqueue')

class SqliteModKv {
  constructor (db) {
    this.db = db
    this.pkq = new KPQueue()
  }
    
  async createTables () {
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS kv (' +
        'key TEXT not null,' +
        'kv_realm TEXT not null,' +
        'value TEXT not null,' +
        'will_sid TEXT not null,' +
        'opt TEXT not null,' +
        'stamp TEXT,'+                    //  out message id
        'PRIMARY KEY (kv_realm, key));'
    )
    await this.db.run(
      'CREATE INDEX IF NOT EXISTS kv_sid on kv (will_sid);'
    )
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS set_value (' +
        'key TEXT not null,' +
        'kv_realm TEXT not null,' +
        'msg_id TEXT not null,' +
        'will_sid TEXT not null,' +
        'set_when TEXT not null,' +
        'PRIMARY KEY (kv_realm, key, msg_id));'
    )
    await this.db.run(
      'CREATE INDEX IF NOT EXISTS set_value_sid on set_value (will_sid);'
    )
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS update_history (' +
        'msg_id TEXT not null,' +
        'msg_origin TEXT not null,' +
        'msg_realm TEXT not null,' +
        'msg_uri TEXT not null,' +
        'msg_oldv TEXT,' +
        'PRIMARY KEY (msg_id));'
    )
  }

  async eraseSessionData (realmName, sessionId, runInboundEvent) {
    const toRemove = []
    await this.db.each(
      'SELECT key, opt FROM kv WHERE kv_realm = ? AND will_sid = ?',
      [realmName, sessionId],
      (err, row) => {
        toRemove.push({key: row.key, opt: row.opt})
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
    //   'DELETE FROM kv WHERE kv_realm = ? AND will_sid = ?',
    //   [realmName, sessionId]
    // )

    await this.db.run(
      'DELETE FROM set_value WHERE kv_realm = ? AND will_sid = ?',
      [realmName, sessionId]
    )
  }

  setKeyValue (realmName, suri, makeId, origin, data, opt, sid, pubOutEvent) {
    this.pkq.enQueue(realmName + '|' + suri, async () => {
      const willSid = ('will' in opt) ? sid : 0
  
      try {
        const oldRow = await this.db.get(
          'SELECT value, opt FROM kv WHERE kv_realm = ? AND key = ?',
          [realmName, suri]
        )
        const oldData = oldRow && oldRow.value ? unSerializeData(JSON.parse(oldRow.value)) : null
        const newData = deepDataMerge(oldData, data)

        const updateHistoryId = makeId.makeIdStr()
        if (isDataEmpty(newData)) {
          await this.db.run('DELETE FROM kv WHERE kv_realm = ? AND key = ?', [realmName, suri])
        } else {
          await this.db.run(
            'INSERT OR REPLACE INTO kv (kv_realm, key, value, will_sid, opt, stamp) VALUES (?, ?, ?, ?, ?, ?)',
            [realmName, suri, JSON.stringify(makeDataSerializable(newData)), willSid, JSON.stringify(opt), updateHistoryId]
          )
        }
        this.saveUpdateHistory(origin, updateHistoryId, realmName, suri, makeDataSerializable(oldData))
        pubOutEvent('event', { sid, oldData, newData })
      } catch (e) {
        console.log('ERROR:', e.message)
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
      await this.db.each(
        'SELECT key, value, opt, stamp FROM kv WHERE kv_realm = ?',
        [realmName],
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

  saveUpdateHistory (id, origin, realmName, suri, oldv, newv) {
    return this.db.run(
      'INSERT INTO update_history VALUES (?,?,?,?,?);',
      [id, origin, realmName, suri, JSON.stringify(oldv)]
    )
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

exports.SqliteKv = SqliteKv
exports.SqliteModKv = SqliteModKv
