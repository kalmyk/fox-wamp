'use strict'

class Kv {
  constructor (db) {
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
    await this.db.each(
      'SELECT key, value FROM kv WHERE sid = ?',
      [sessionId],
      (err, row) => {
        console.log("DELETE", row);
      }
    )
    // DELETE FROM set_value WHERE sid = sessionId
  }
}

exports.Kv = Kv
