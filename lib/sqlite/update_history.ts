import * as sqlite from 'sqlite'

export async function createUpdateHistoryTable(db: sqlite.Database, realmName: string) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS update_history_${realmName} (
      msg_id TEXT NOT NULL,
      old_updated_by_msg_id TEXT,
      topic TEXT NOT NULL,
      msg_oldv TEXT,
      msg_newv TEXT,
      PRIMARY KEY (topic, msg_id)
    );`
  )
}

export async function saveUpdateHistory(
  db: sqlite.Database,
  realmName: string,
  id: string,
  oldUpdatedByMsgId: string | null,
  topic: string,
  oldv: any,
  newv: any
) {
  return db.run(
    `INSERT INTO update_history_${realmName} (
      msg_id, old_updated_by_msg_id, topic, msg_oldv, msg_newv
    ) VALUES (?, ?, ?, ?, ?);`,
    [
      id,
      oldUpdatedByMsgId,
      topic,
      oldv === null ? null : JSON.stringify(oldv),
      newv === null ? null : JSON.stringify(newv)
    ]
  )
}
