'use strict'

const { defaultParse, restoreUri } = require('../topic_pattern')

function Msg (database) {
  this.createTables = function () {
    return database.run(
      'CREATE TABLE IF NOT EXISTS msg (' +
        'msg_id TEXT not null,' +
        'msg_realm TEXT not null,' +
        'msg_uri TEXT not null,' +
        'msg_body TEXT,' +
        'PRIMARY KEY (msg_id));'
    )
  }

  this.getMaxId = function () {
    return database.all(
      'SELECT MAX(msg_id) max_id FROM msg', []
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

  this.saveMsg = function (id, realm, uri, body) {
    return database.run(
      'insert into msg values (?,?,?,?);',
      [id, realm, restoreUri(uri), JSON.stringify(body)]
    )
  }

  this.getHistory = function (realm, range, rowcb) {
    let sql = 'SELECT msg_id, msg_uri, msg_body FROM msg'
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
    return database.each(
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

module.exports = Msg
