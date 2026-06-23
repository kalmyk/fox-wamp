import * as sqlite from 'sqlite'
import { match, restoreUri, defaultParse } from '../topic_pattern'
import { isDataEmpty, deepDataMerge, unSerializeData, makeDataSerializable, isDataFit } from '../realm'
import { DbFactory } from './dbfactory'
import { ProduceId } from '../masterfree/makeid'
import { createUpdateHistoryTable, saveUpdateHistory } from './update_history'

export async function createKvTables (db: sqlite.Database, realmName: string) {
  await createUpdateHistoryTable(db, realmName)
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_${realmName} (
      -- Canonical dotted FOX topic text, never MQTT slash syntax.
      topic TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      opt TEXT not null,
      updated_by_msg_id TEXT,
      PRIMARY KEY (topic));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS kv_sid_${realmName} on kv_${realmName} (will_sid);`
  )
  await db.run(
    `DROP TABLE IF EXISTS set_value_${realmName};`
  )
  await db.run(
    `CREATE TABLE IF NOT EXISTS session_kv_${realmName} (
      -- Canonical dotted FOX topic text, never MQTT slash syntax.
      topic TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      msg_id TEXT not null,
      PRIMARY KEY (topic));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS session_kv_sid_${realmName} on session_kv_${realmName} (will_sid);`
  )
}

export class SqliteKvFabric {
  private makeId: ProduceId
  private dbFactory: DbFactory

  constructor (dbFactory: DbFactory, makeId: ProduceId) {
    this.dbFactory = dbFactory
    this.makeId = makeId
  }

  getDbFactory (): DbFactory {
    return this.dbFactory
  }

  async getDb(realmName: string): Promise<sqlite.Database> {
    return this.dbFactory.getDb(realmName)
  }

  public async getStoredValue(db: sqlite.Database, realmName: string, suri: string): Promise<{value: any, updatedByMsgId: string | null}> {
    const oldRow = await db.get(
      `SELECT value, updated_by_msg_id FROM kv_${realmName} WHERE topic = ?`,
      [suri]
    )
    return {
      value: oldRow && oldRow.value ? unSerializeData(JSON.parse(oldRow.value)) : null,
      updatedByMsgId: oldRow ? oldRow.updated_by_msg_id : null
    }
  }

  public async writeKvLocked(
    db: sqlite.Database,
    realmName: string,
    suri: string,
    origin: string,
    data: any,
    opt: any,
    sid: string
  ): Promise<{ newData: any, whenNotMet: boolean }> {
    const { value: oldData, updatedByMsgId: oldUpdatedByMsgId } = await this.getStoredValue(db, realmName, suri)

    if ('when' in opt && !isDataFit(opt.when, oldData)) {
      return { newData: oldData, whenNotMet: true }
    }

    const newData = deepDataMerge(oldData, data)
    const updateHistoryId = this.makeId.generateIdStr()

    await db.run(`DELETE FROM session_kv_${realmName} WHERE topic = ?`, [suri])
    if (isDataEmpty(newData)) {
      await db.run(`DELETE FROM kv_${realmName} WHERE topic = ?`, [suri])
    } else {
      const willSid = ('will' in opt) ? sid : 0
      await db.run(
        `INSERT OR REPLACE INTO kv_${realmName} (topic, value, will_sid, opt, updated_by_msg_id) VALUES (?, ?, ?, ?, ?)`,
        [suri, JSON.stringify(makeDataSerializable(newData)), willSid, JSON.stringify(opt), updateHistoryId]
      )
    }
    if ('will' in opt) {
      await db.run(
        `INSERT INTO session_kv_${realmName} (topic, value, will_sid, msg_id) VALUES (?, ?, ?, ?)`,
        [suri, JSON.stringify(makeDataSerializable(opt.will)), sid, origin]
      )
    }
    await saveUpdateHistory(
      db,
      realmName,
      updateHistoryId,
      oldUpdatedByMsgId,
      suri,
      oldData === null ? null : makeDataSerializable(oldData),
      isDataEmpty(newData) ? null : makeDataSerializable(newData)
    )

    return { newData, whenNotMet: false }
  }

  async eraseSessionData (realmName: string, sessionId: string, runInboundEvent: (sid: string, key: string[], will: any) => Promise<any> | void) {
    const toApply: {topic: string, value: any}[] = []
    const db = await this.getDb(realmName)
    await db.each(
      `SELECT topic, value FROM session_kv_${realmName} WHERE will_sid = ?`,
      [sessionId],
      (err, row) => {
        toApply.push({
          topic: row.topic,
          value: unSerializeData(JSON.parse(row.value))
        })
      }
    )
    for (let row of toApply) {
      await runInboundEvent(sessionId, defaultParse(row.topic), row.value)
      await db.run(
        `DELETE FROM session_kv_${realmName} WHERE topic = ? AND will_sid = ?`,
        [row.topic, sessionId]
      )
    }
  }

  async processStaleRecords (realmName: string, runInboundEvent: (sid: string, key: string[], will: any) => Promise<any> | void): Promise<void> {
    const toApply: {topic: string, value: any, willSid: string}[] = []
    const db = await this.getDb(realmName)
    await db.each(
      `SELECT topic, value, will_sid FROM session_kv_${realmName}`,
      [],
      (err, row) => {
        toApply.push({
          topic: row.topic,
          value: unSerializeData(JSON.parse(row.value)),
          willSid: row.will_sid
        })
      }
    )
    for (let row of toApply) {
      await runInboundEvent(row.willSid, defaultParse(row.topic), row.value)
      await db.run(
        `DELETE FROM session_kv_${realmName} WHERE topic = ? AND will_sid = ?`,
        [row.topic, row.willSid]
      )
    }
  }

  // @uri is array of strings
  getKey (realmName: string, uri: string[], cbRow: (key: string[], data: any, updatedByMsgId: string) => void) {
    return (async () => {
      const db = await this.getDb(realmName)
      await db.each(
        `SELECT topic, value, opt, updated_by_msg_id FROM kv_${realmName}`,
        [],
        (err, row) => {
          const aKey: string[] = defaultParse(row.topic)
          if (match(aKey, uri)) {
            const rowData = JSON.parse(row.value)
            cbRow(aKey, unSerializeData(rowData), row.updated_by_msg_id)
          }
        }
      )
    })()
  }
}

