'use strict'

const { KeyValueStorageAbstract } = require('../realm')

class SqliteKv extends KeyValueStorageAbstract {
  constructor (db) {
    super()
    this.db = db
  }
    
  async createTables () {
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS kv (' +
        'key TEXT not null,' +
        'value TEXT not null,' +
        'sid TEXT not null,' +
        'opt TEXT not null,' +
        'PRIMARY KEY (key));'
    )
    await this.db.run(
      'CREATE INDEX IF NOT EXISTS kv_sid on kv (sid);'
    )
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS set_value (' +
        'key TEXT not null,' +
        'msg_id TEXT not null,' +
        'sid TEXT not null,' +
        'set_when TEXT not null,' +
        'PRIMARY KEY (key, msg_id));'
    )
    await this.db.run(
      'CREATE INDEX IF NOT EXISTS set_value_sid on set_value (sid);'
    )
  }

  async removeSession (sessionId) {
    const toDelete = []
    await this.db.each(
      'SELECT key, opt FROM kv WHERE sid = ?',
      [sessionId],
      (err, row) => {
        toDelete.push([row.key, row.opt])
        console.log("TO-DELETE", row)
      }
    )
    // 
    // DELETE FROM set_value WHERE sid = sessionId
  }

  setKeyActor (actor) {
    const suri = this.getStrUri(actor)

    this.db.run(
      'insert into kv (key, value, sid, opt) values (?, ?, "", ?)',
      [suri, JSON.stringify(actor.getData()), JSON.stringify(actor.getOpt())]
    ).then(() => {

    }, (reason) => {
      console.log(reason)
    })
  }

  getKey (uri, cbRow) {
    return this.db.each(
      'SELECT key, value, opt FROM kv WHERE key = ?',
      [uri],
      (err, row) => {
        cbRow(row.key, JSON.parse(row.value))
      }
    )

  }
}

exports.SqliteKv = SqliteKv
