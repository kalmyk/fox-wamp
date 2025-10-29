import * as sqlite from 'sqlite'
import { defaultParse, restoreUri } from '../topic_pattern'

// Fetch all table names that match the pattern 'event_history_%'
// and call the callback with the realm name extracted from the table name.
export async function forEachRealm (db: sqlite.Database, callback: (realmName: string) => Promise<void>) {
  const tableNames = await db.all(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'event_history_%'",
    []
  )
  for (const row of tableNames) {
    await callback(row.name.substr(14))  // length of 'event_history_' is 14
  }
}

export async function createHistoryTables (db: sqlite.Database, realmName: string) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS event_history_${realmName} (
      msg_id TEXT not null,
      msg_shard INTEGER,
      msg_uri TEXT not null,
      msg_body TEXT,
      msg_opt TEXT,
      PRIMARY KEY (msg_id));
    `, []
  )
}

export async function saveEventHistory (db: sqlite.Database, realmName: string, id: string, shard: number, uri:any, body:any, opt:any) {
  return db.run(
    `INSERT INTO event_history_${realmName} (msg_id, msg_shard, msg_uri, msg_body, msg_opt) VALUES (?, ?, ?, ?, ?);`,
    [id, shard, restoreUri(uri), JSON.stringify(body), JSON.stringify(opt)]
  )
}

export async function scanMaxId (db: sqlite.Database) {
  let maxId = ''
  await forEachRealm(db, async (realmName: string) => {
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

export async function getEventHistory (db: sqlite.Database, realmName: string, range:any, rowcb:any) {
  let sql = `SELECT msg_id, msg_shard, msg_uri, msg_body, msg_opt FROM event_history_${realmName}`
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
        shard: row.msg_shard,
        uri: defaultParse(row.msg_uri),
        body: JSON.parse(row.msg_body),
        opt: JSON.parse(row.msg_opt)
      })
    }
  )
}
