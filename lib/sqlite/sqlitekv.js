'use strict'

const { restoreUri, defaultParse } = require('../topic_pattern')
const { KeyValueStorageAbstract, isDataEmpty, deepDataMerge } = require('../realm')

class SqliteKv extends KeyValueStorageAbstract {
  constructor (db, realmName) {
    super()
    this.db = db
    this.keyLock = new Map()
    this.sLock = new Map()
    this.realmName = realmName
  }
    
  async createTables () {
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS kv (' +
        'key TEXT not null,' +
        'kv_realm TEXT not null,' +
        'value TEXT not null,' +
        'will_sid TEXT not null,' +
        'opt TEXT not null,' +
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
  }

  runDefer (strUri, defer) {
    defer.cb().then(
      (res) => { this.deQueue(strUri); defer.resolve(res) },
      (res) => { this.deQueue(strUri); defer.reject(res) }
    )
  }

  enQueue (strUri, cb) {
    let queue = this.keyLock.get(strUri)
    if (!queue) {
      queue = []
      this.keyLock.set(strUri, queue)
    }
    const defer = { cb }
    const result = new Promise ((resolve, reject) => {
      defer.resolve = resolve
      defer.reject = reject
    })
    queue.push(defer)
    if (queue.length == 1) {
      this.runDefer(strUri, defer)
    }
    return result
  }

  deQueue (strUri) {
    let queue = this.keyLock.get(strUri)
    if (!queue) {
      throw 'Queue-Error!'
    }
    queue.shift()
    if (queue.length > 0) {
      this.runDefer(strUri, queue[0])
    } else {
      this.keyLock.delete(strUri)
    }
  }

  async eraseSessionData (sessionId) {
    const toRemove = []
    await this.db.each(
      'SELECT key, opt FROM kv WHERE kv_realm = ? AND will_sid = ?',
      [this.realmName, sessionId],
      (err, row) => {
        toRemove.push({key: row.key, opt: row.opt})
      }
    )
    for (let row of toRemove) {
      if (row.opt.will) {
        this.runInboundEvent(defaultParse(row.key), row.opt.will)
      } else {
        this.runInboundEvent(defaultParse(row.key), null)
      }
    }
    // erase is expected to be done by incoming message
    // await this.db.run(
    //   'DELETE FROM kv WHERE kv_realm = ? AND will_sid = ?',
    //   [this.realmName, sessionId]
    // )

    await this.db.run(
      'DELETE FROM set_value WHERE kv_realm = ? AND will_sid = ?',
      [this.realmName, sessionId]
    )
  }

  setKeyActor (actor) {
    const suri = this.getStrUri(actor)
    this.enQueue(suri, async () => {
      const opt = actor.getOpt()
      const willSid = ('will' in opt) ? actor.getSid() : 0
  
      try {
        const oldData = await this.db.get(
          'SELECT value, opt FROM kv WHERE kv_realm = ? AND key = ?',
          [this.realmName, suri]
        )
        const newData = deepDataMerge(oldData ? oldData.value : null, actor.getData())

        if (isDataEmpty(newData)) {
          await this.db.run('DELETE FROM kv WHERE kv_realm = ? AND key = ?', [this.realmName, suri])
        } else {
          await this.db.run(
            'INSERT OR REPLACE INTO kv (kv_realm, key, value, will_sid, opt) VALUES (?, ?, ?, ?, ?)',
            [this.realmName, suri, JSON.stringify(actor.getData()), willSid, JSON.stringify(opt)]
          )
        }
        actor.confirm(actor.msg)
      } catch (e) {
        console.log('ERROR:', e.message)
      }
    })
  }

  // @return promise
  getKey (uri, cbRow) {
    const strUri = restoreUri(uri)
    return this.enQueue(strUri, async () => {
      await this.db.each(
        'SELECT key, value, opt FROM kv WHERE key = ?',
        [strUri],
        (err, row) => {
          cbRow(row.key, JSON.parse(row.value))
        }
      )
    })
  }
}

exports.SqliteKv = SqliteKv
