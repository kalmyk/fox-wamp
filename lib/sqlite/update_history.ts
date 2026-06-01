import * as sqlite from 'sqlite'

export type UpdateHistoryEntityType = 'kv' | 'schema' | 'kv_storage'

export async function createUpdateHistoryTable(db: sqlite.Database, realmName: string) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS update_history_${realmName} (
      msg_id TEXT NOT NULL,
      old_updated_by_msg_id TEXT,
      entity_type TEXT NOT NULL CHECK(entity_type IN ('kv', 'schema', 'kv_storage')),
      entity_uri TEXT NOT NULL,
      msg_oldv TEXT,
      msg_newv TEXT,
      PRIMARY KEY (entity_uri, msg_id)
    );`
  )
}

export async function saveUpdateHistory(
  db: sqlite.Database,
  realmName: string,
  id: string,
  oldUpdatedByMsgId: string | null,
  entityType: UpdateHistoryEntityType,
  entityUri: string,
  oldv: any,
  newv: any
) {
  return db.run(
    `INSERT INTO update_history_${realmName} (
      msg_id, old_updated_by_msg_id, entity_type, entity_uri, msg_oldv, msg_newv
    ) VALUES (?, ?, ?, ?, ?, ?);`,
    [
      id,
      oldUpdatedByMsgId,
      entityType,
      entityUri,
      oldv === null ? null : JSON.stringify(oldv),
      newv === null ? null : JSON.stringify(newv)
    ]
  )
}
