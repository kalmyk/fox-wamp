import * as sqlite from 'sqlite'
import { match, restoreUri, defaultParse } from '../topic_pattern'
import { KeyValueStorageAbstract, isDataEmpty, deepDataMerge, unSerializeData, makeDataSerializable } from '../realm'
import { KPQueue } from '../masterfree/kpqueue'
import { getDbFactoryInstance } from './dbfactory'
import { ActorPush } from '../realm'
import { keyDate, ProduceId } from '../masterfree/makeid'

export async function createKvTables (db: sqlite.Database, realmName: string) {
  await db.run(
    `CREATE TABLE IF NOT EXISTS update_history_${realmName} (
      msg_id TEXT not null,
      msg_origin TEXT not null,
      msg_uri TEXT not null,
      msg_oldv TEXT,
      PRIMARY KEY (msg_id));`
  )
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_${realmName} (
      key TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      opt TEXT not null,
      stamp TEXT,
      PRIMARY KEY (key));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS kv_sid_${realmName} on kv_${realmName} (will_sid);`
  )
  await db.run(
    `CREATE TABLE IF NOT EXISTS set_value_${realmName} (
      key TEXT not null,
      msg_id TEXT not null,
      will_sid TEXT not null,
      set_when TEXT not null,
      PRIMARY KEY (key, msg_id));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS set_value_sid_${realmName} on set_value_${realmName} (will_sid);`
  )
}

export async function saveUpdateHistory (db: sqlite.Database, realmName: string, id: string, origin: string, suri: string, oldv: any) {
  return db.run(
    `INSERT INTO update_history_${realmName} VALUES (?,?,?,?);`,
    [id, origin, suri, JSON.stringify(oldv)]
  )
}

export class SqliteKvFabric {
  private db: sqlite.Database
  private pkq: KPQueue = new KPQueue()
  private makeId: ProduceId = new ProduceId(() => keyDate(new Date()))

  constructor (db: sqlite.Database) {
    this.db = db
  }

  async eraseSessionData (realmName: string, sessionId: string, runInboundEvent: (sid: string, key: string[], will: any) => void) {
    const toRemove: {key: string, opt: any}[] = []
    await this.db.each(
      `SELECT key, opt FROM kv_${realmName} WHERE will_sid = ?`,
      [sessionId],
      (err, row) => {
        toRemove.push({key: row.key, opt: JSON.parse(row.opt)})
      }
    )
    for (let row of toRemove) {
      if (row.opt.will) {
        runInboundEvent(sessionId, defaultParse(row.key), row.opt.will)
      } else {
        runInboundEvent(sessionId, defaultParse(row.key), null)
      }
    }
    // erase is expected to be done by incoming message
    // await this.db.run(
    //   `DELETE FROM kv_${realmName} WHERE will_sid = ?`,
    //   [realmName, sessionId]
    // )

    await this.db.run(
      `DELETE FROM set_value_${realmName} WHERE will_sid = ?`,
      [sessionId]
    )
  }

  // @return promise
  setKeyValue (realmName: string, suri: string, origin: string, data: any, opt: any, sid: string, pubOutEvent: (kind: string, outEvent: any) => void) {
    return this.pkq.enQueue(realmName + '|' + suri, async () => {
      const willSid = ('will' in opt) ? sid : 0
  
      try {
        const oldRow = await this.db.get(
          `SELECT value, opt FROM kv_${realmName} WHERE key = ?`,
          [suri]
        )
        const oldData = oldRow && oldRow.value ? unSerializeData(JSON.parse(oldRow.value)) : null
        const newData = deepDataMerge(oldData, data)

        const updateHistoryId = this.makeId.generateIdStr()
        if (isDataEmpty(newData)) {
          await this.db.run(`DELETE FROM kv_${realmName} WHERE key = ?`, [suri])
        } else {
          await this.db.run(
            `INSERT OR REPLACE INTO kv_${realmName} (key, value, will_sid, opt, stamp) VALUES (?, ?, ?, ?, ?)`,
            [suri, JSON.stringify(makeDataSerializable(newData)), willSid, JSON.stringify(opt), updateHistoryId]
          )
        }
        saveUpdateHistory(this.db, realmName, origin, updateHistoryId, suri, makeDataSerializable(oldData))
        pubOutEvent('event', { sid, oldData, newData })
      } catch (e: any) {
        console.log('SetKeyValue ERROR:', e.message, e.stack)
      }
    })
  }

  async applySegment(segment: any[], pubOutEvent: (kind: string, outEvent: any) => void) {
    for (let inEvent of segment) {
      console.log("MOD-KV", inEvent)
      if (inEvent.opt.trace) {
        await this.setKeyValue(
          inEvent.realm,
          restoreUri(inEvent.uri),
          inEvent.qid,
          inEvent.data,
          inEvent.opt,
          inEvent.sid,
          pubOutEvent
        )
      }
    }
  }

  // @uri is array of strings
  getKey (realmName: string, uri: string[], cbRow: (key: string[], data: any, stamp: string) => void) {
    const strUri = restoreUri(uri)
    return this.pkq.enQueue(realmName + '|' + strUri, async () => {
      // TODO: optimize search
      await this.db.each(
        `SELECT key, value, opt, stamp FROM kv_${realmName}`,
        [],
        (err, row) => {
          const aKey: string[] = defaultParse(row.key)
          if (match(aKey, uri)) {
            const rowData = JSON.parse(row.value)
            cbRow(aKey, unSerializeData(rowData), row.stamp)
          }
        }
      )
    })
  }
}

export class SqliteKv extends KeyValueStorageAbstract {
  private mod: SqliteKvFabric
  private realmName: string

  constructor (mod: SqliteKvFabric, realmName: string) {
    super()
    this.mod = mod
    this.realmName = realmName
  }
    
  eraseSessionData (sessionId: string) {
    return this.mod.eraseSessionData (this.realmName, sessionId, this.runInboundEvent.bind(this))
  }

  // @result promise
  setKeyActor (actor: ActorPush) {
    const suri = this.getStrUri(actor)
    return this.mod.setKeyValue(
      this.realmName,
      suri,
      actor.getEventId(),
      actor.getData(),
      actor.getOpt(),
      actor.getSid(),
      (kind:any, outEvent:any) => actor.confirm(actor.msg)
    )
  }

  // @return promise
  getKey (uri: [string], cbRow:any) {
    return this.mod.getKey(this.realmName, uri, cbRow)
  }
}
