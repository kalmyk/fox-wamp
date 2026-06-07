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
    const realmName = row.name.substr(14) // length of 'event_history_' str is 14
    await callback(realmName)
  }
}

export async function createHistoryTables (db: sqlite.Database, realmName: string) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS event_history_${realmName} (
      msg_id TEXT not null,
      msg_shard INTEGER,
      -- Canonical dotted FOX topic text. Use defaultParse()/restoreUri();
      -- MQTT slash syntax is normalized before history storage.
      msg_uri TEXT not null,
      msg_body TEXT,
      msg_opt TEXT,
      PRIMARY KEY (msg_id));
    `, []
  )
}

export async function saveEventHistory (db: sqlite.Database, realmName: string, id: string, shard: number, uri:any, body:any, opt:any) {
  // Persist topics in canonical dotted form even when the publish arrived via MQTT.
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

export async function getEventHistory (db: sqlite.Database, realmName: string, range: { fromId?: string, toId?: string, uri?: string[] }, rowcb: (event: any) => Promise<void>) {
  let sql = `SELECT msg_id, msg_shard, msg_uri, msg_body, msg_opt FROM event_history_${realmName}`
  let where = []
  let params: any[] = []
  
  if (range.fromId) {
    where.push('msg_id > ?')
    params.push(range.fromId)
  }
  if (range.toId) {
    where.push('msg_id <= ?')
    params.push(range.toId)
  }
  if (range.uri) {
    where.push('msg_uri = ?')
    params.push(restoreUri(range.uri))
  }
  
  if (where.length > 0) {
    sql += ' WHERE ' + where.join(' AND ')
  }
  sql += ' ORDER BY msg_id'

  const rows = await db.all(sql, params)
  for (const row of rows) {
    await rowcb({
      id: row.msg_id,
      shard: row.msg_shard,
      uri: defaultParse(row.msg_uri),
      body: JSON.parse(row.msg_body),
      opt: JSON.parse(row.msg_opt)
    })
  }
  return rows.length
}
