'use strict'

const { defaultParse, restoreUri } = require('../topic_pattern')

class History {
  constructor (database) {
    this.database = database
  }

  async createTables () {
    await this.database.run(
      'CREATE TABLE IF NOT EXISTS event_history (' +
        'msg_id TEXT not null,' +
        'msg_realm TEXT not null,' +
        'msg_uri TEXT not null,' +
        'msg_body TEXT,' +
        'PRIMARY KEY (msg_id));'
    )
    await this.database.run(
      'CREATE TABLE IF NOT EXISTS update_history (' +
        'msg_id TEXT not null,' +
        'msg_origin TEXT not null,' +
        'msg_realm TEXT not null,' +
        'msg_uri TEXT not null,' +
        'msg_body TEXT,' +
        'PRIMARY KEY (msg_id));'
    )
  }

  getMaxId () {
    return this.database.all(
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

  saveEventHistory (id, origin, realm, uri, body) {
    return this.database.run(
      'INSERT INTO event_history VALUES (?,?,?,?);',
      [id, realm, restoreUri(uri), JSON.stringify(body)]
    )
  }

  saveUpdateHistory (id, origin, realm, uri, body) {
    return this.database.run(
      'INSERT INTO update_history VALUES (?,?,?,?,?);',
      [id, origin, realm, restoreUri(uri), JSON.stringify(body)]
    )
  }

  getEventHistory (realm, range, rowcb) {
    let sql = 'SELECT msg_id, msg_uri, msg_body FROM event_history'
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
    return this.database.each(
      sql,
      [realm, restoreUri(range.uri)],
      (err, row) => {
        rowcb({
          id: row.msg_id,
          uri: defaultParse(row.msg_uri),
          body: JSON.parse(row.msg_body)
        })
      }
    )
  }
}

exports.History = History
