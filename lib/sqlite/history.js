'use strict'

const { defaultParse, restoreUri } = require('../topic_pattern')

class History {
  constructor (db) {
    this.db = db
  }

  async createTables () {
    await this.db.run(
      'CREATE TABLE IF NOT EXISTS event_history (' +
        'msg_id TEXT not null,' +
        'msg_realm TEXT not null,' +
        'msg_uri TEXT not null,' +
        'msg_body TEXT,' +
        'msg_opt TEXT,' +
        'PRIMARY KEY (msg_id));'
    )
  }

  getMaxId () {
    return this.db.all(
      'SELECT MAX(msg_id) max_id FROM event_history', []
    ).then((result) => {
      if (!Array.isArray(result)) {
        return undefined
      }
      if (result.length === 0) {
        return undefined
      }
      if (result[0].max_id) {
        return result[0].max_id
      } else {
        return undefined
      }
    })
  }

  saveEventHistory (id, realm, uri, body, opt) {
    return this.db.run(
      'INSERT INTO event_history VALUES (?,?,?,?,?);',
      [id, realm, restoreUri(uri), JSON.stringify(body), JSON.stringify(opt)]
    )
  }

  getEventHistory (realm, range, rowcb) {
    let sql = 'SELECT msg_id, msg_uri, msg_body, msg_opt FROM event_history'
    let where = []
    if (range.fromId) {
      where.push('msg_id > "' + range.fromId + '"')
    }
    if (range.toId) {
      where.push('msg_id <= "' + range.toId + '"')
    }

    where.push('msg_realm = ?')
    where.push('msg_uri = ?')
    sql += ' WHERE ' + where.join(' AND ') + ' ORDER BY msg_id'

    // console.log('range', [realm, restoreUri(range.uri)], sql)
    return this.db.each(
      sql,
      [realm, restoreUri(range.uri)],
      (err, row) => {
        rowcb({
          id: row.msg_id,
          uri: defaultParse(row.msg_uri),
          body: JSON.parse(row.msg_body),
          opt: JSON.parse(row.msg_opt)
        })
      }
    )
  }
}

exports.History = History
