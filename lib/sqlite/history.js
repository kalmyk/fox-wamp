'use strict'

const { defaultParse, restoreUri } = require('../topic_pattern')

async function forEachRealm (db, callback) {
  const tableNames = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'event_history_%'",
    []
  )
  for (const row of tableNames) {
    await callback(row.name.substr(14))  // length of 'event_history_' is 14
  }
}

async function createHistoryTables (db, realmName) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS event_history_${realmName} (
      msg_id TEXT not null,
      msg_uri TEXT not null,
      msg_body TEXT,
      msg_opt TEXT,
      PRIMARY KEY (msg_id));
    `, []
  )
}

async function saveEventHistory (db, realmName, id, uri, body, opt) {
  return db.run(
    `INSERT INTO event_history_${realmName} (msg_id, msg_uri, msg_body, msg_opt) VALUES (?, ?, ?, ?);`,
    [id, restoreUri(uri), JSON.stringify(body), JSON.stringify(opt)]
  )
}

async function scanMaxId (db) {
  let maxId = ''
  await forEachRealm(db, async (realmName) => {
    const maxRow = await db.all(
      `SELECT MAX(msg_id) max_id FROM event_history_${realmName}`, []
    )
    if (!Array.isArray(maxRow)) {
      return
    }
    if (maxRow.length === 0) {
      return
    }
    if (maxRow[0].max_id) {
      const localMaxId = maxRow[0].max_id
      maxId = maxId < localMaxId ? localMaxId : maxId
    }
  })
  return maxId
}

async function getEventHistory (db, realmName, range, rowcb) {
  let sql = `SELECT msg_id, msg_uri, msg_body, msg_opt FROM event_history_${realmName}`
  let where = []
  if (range.fromId) {
    where.push('msg_id > "' + range.fromId + '"')
  }
  if (range.toId) {
    where.push('msg_id <= "' + range.toId + '"')
  }
  where.push('msg_uri = ?')
  sql += ' WHERE ' + where.join(' AND ') + ' ORDER BY msg_id'

  return db.each(
    sql,
    [restoreUri(range.uri)],
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

exports.forEachRealm = forEachRealm
exports.createHistoryTables = createHistoryTables
exports.scanMaxId = scanMaxId
exports.saveEventHistory = saveEventHistory
exports.getEventHistory = getEventHistory
