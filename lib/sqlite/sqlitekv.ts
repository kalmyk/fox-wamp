import * as sqlite from 'sqlite'
import { match, restoreUri, defaultParse } from '../topic_pattern'
import { KeyValueStorageAbstract, isDataEmpty, deepDataMerge, unSerializeData, makeDataSerializable, isDataFit, IActorPush } from '../realm'
import { KPQueue } from '../masterfree/kpqueue'
import { DbFactory } from './dbfactory'
import { ProduceId } from '../masterfree/makeid'
import { errorCodes } from '../realm_error'
import { createUpdateHistoryTable, saveUpdateHistory, UpdateHistoryAction } from './update_history'

export async function createKvTables (db: sqlite.Database, realmName: string) {
  await createUpdateHistoryTable(db, realmName)
  await db.run(
    `CREATE TABLE IF NOT EXISTS kv_${realmName} (
      -- Canonical dotted FOX topic text, never MQTT slash syntax.
      key TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      opt TEXT not null,
      updated_by_msg_id TEXT,
      PRIMARY KEY (key));`
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
      key TEXT not null,
      value TEXT not null,
      will_sid TEXT not null,
      msg_id TEXT not null,
      PRIMARY KEY (key));`
  )
  await db.run(
    `CREATE INDEX IF NOT EXISTS session_kv_sid_${realmName} on session_kv_${realmName} (will_sid);`
  )
}

export class SqliteKvFabric {
  private pkq: KPQueue = new KPQueue()
  private makeId: ProduceId
  private dbFactory: DbFactory
  private resWhen: Map<string, IActorPush[]> = new Map()

  constructor (dbFactory: DbFactory, makeId: ProduceId) {
    this.dbFactory = dbFactory
    this.makeId = makeId
  }

  async getDb(realmName: string): Promise<sqlite.Database> {
    return this.dbFactory.getDb(realmName)
  }

  private getWaitKey(realmName: string, suri: string): string {
    return realmName + '|' + suri
  }

  private cleanupWaiters(sessionId: string): void {
    for (const [key, actors] of this.resWhen) {
      for (let i = actors.length - 1; i >= 0; i--) {
        if (actors[i].getSid() === sessionId || !actors[i].isActive()) {
          actors.splice(i, 1)
        }
      }
      if (actors.length === 0) {
        this.resWhen.delete(key)
      }
    }
  }

  private async getStoredValue(db: sqlite.Database, realmName: string, suri: string): Promise<{value: any, updatedByMsgId: string | null}> {
    const oldRow = await db.get(
      `SELECT value, updated_by_msg_id FROM kv_${realmName} WHERE key = ?`,
      [suri]
    )
    return {
      value: oldRow && oldRow.value ? unSerializeData(JSON.parse(oldRow.value)) : null,
      updatedByMsgId: oldRow ? oldRow.updated_by_msg_id : null
    }
  }

  private parkActor(realmName: string, suri: string, actor: IActorPush): void {
    const waitKey = this.getWaitKey(realmName, suri)
    if (!this.resWhen.has(waitKey)) {
      this.resWhen.set(waitKey, [])
    }
    this.resWhen.get(waitKey)!.push(actor)
  }

  private async findNextWhenActor(realmName: string, suri: string, curData: any): Promise<IActorPush | false> {
    const waitKey = this.getWaitKey(realmName, suri)
    const actors = this.resWhen.get(waitKey)
    if (!actors) {
      return false
    }
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]
      if (!actor.isActive()) {
        actors.splice(i, 1)
        i--
        continue
      }
      if (isDataFit(actor.getOpt().when, curData)) {
        actors.splice(i, 1)
        if (actors.length === 0) {
          this.resWhen.delete(waitKey)
        }
        return actor
      }
    }
    if (actors.length === 0) {
      this.resWhen.delete(waitKey)
    }
    return false
  }

  async eraseSessionData (realmName: string, sessionId: string, runInboundEvent: (sid: string, key: string[], will: any) => Promise<any> | void) {
    this.cleanupWaiters(sessionId)
    const toApply: {key: string, value: any}[] = []
    const db = await this.getDb(realmName)
    await db.each(
      `SELECT key, value FROM session_kv_${realmName} WHERE will_sid = ?`,
      [sessionId],
      (err, row) => {
        toApply.push({
          key: row.key,
          value: unSerializeData(JSON.parse(row.value))
        })
      }
    )
    for (let row of toApply) {
      await runInboundEvent(sessionId, defaultParse(row.key), row.value)
      await db.run(
        `DELETE FROM session_kv_${realmName} WHERE key = ? AND will_sid = ?`,
        [row.key, sessionId]
      )
    }
  }

  async processStaleRecords (realmName: string, runInboundEvent: (sid: string, key: string[], will: any) => Promise<any> | void): Promise<void> {
    const toApply: {key: string, value: any, willSid: string}[] = []
    const db = await this.getDb(realmName)
    await db.each(
      `SELECT key, value, will_sid FROM session_kv_${realmName}`,
      [],
      (err, row) => {
        toApply.push({
          key: row.key,
          value: unSerializeData(JSON.parse(row.value)),
          willSid: row.will_sid
        })
      }
    )
    for (let row of toApply) {
      await runInboundEvent(row.willSid, defaultParse(row.key), row.value)
      await db.run(
        `DELETE FROM session_kv_${realmName} WHERE key = ? AND will_sid = ?`,
        [row.key, row.willSid]
      )
    }
  }

  private async setKeyValueLocked(
    db: sqlite.Database,
    realmName: string,
    suri: string,
    origin: string,
    data: any,
    opt: any,
    sid: string,
    actor?: IActorPush
  ): Promise<void> {
    const { value: oldData, updatedByMsgId: oldUpdatedByMsgId } = await this.getStoredValue(db, realmName, suri)
    if ('when' in opt && !isDataFit(opt.when, oldData)) {
      if (opt.watch && actor) {
        this.parkActor(realmName, suri, actor)
      } else if (actor) {
        actor.rejectCmd(String(errorCodes.ERROR_INVALID_PAYLOAD), 'not accepted')
      }
      return
    }

    const newData = deepDataMerge(oldData, data)
    const updateHistoryId = this.makeId.generateIdStr()

    let action: UpdateHistoryAction = 'update'
    if (oldData === null) {
      action = 'create'
    } else if (isDataEmpty(newData)) {
      action = 'delete'
    }

    await db.run(`DELETE FROM session_kv_${realmName} WHERE key = ?`, [suri])
    if (isDataEmpty(newData)) {
      await db.run(`DELETE FROM kv_${realmName} WHERE key = ?`, [suri])
    } else {
      const willSid = ('will' in opt) ? sid : 0
      await db.run(
        `INSERT OR REPLACE INTO kv_${realmName} (key, value, will_sid, opt, updated_by_msg_id) VALUES (?, ?, ?, ?, ?)`,
        [suri, JSON.stringify(makeDataSerializable(newData)), willSid, JSON.stringify(opt), updateHistoryId]
      )
    }
    if ('will' in opt) {
      await db.run(
        `INSERT INTO session_kv_${realmName} (key, value, will_sid, msg_id) VALUES (?, ?, ?, ?)`,
        [suri, JSON.stringify(makeDataSerializable(opt.will)), sid, origin]
      )
    }
    await saveUpdateHistory(
      db,
      realmName,
      updateHistoryId,
      oldUpdatedByMsgId,
      'kv',
      suri,
      action,
      action === 'create' ? null : makeDataSerializable(oldData),
      action === 'delete' ? null : makeDataSerializable(newData)
    )
    if (actor) {
      actor.confirm((actor as any).msg)
    }

    let nextActor = await this.findNextWhenActor(realmName, suri, newData)
    while (nextActor) {
      const { updatedByMsgId: nextOldUpdatedByMsgId } = await this.getStoredValue(db, realmName, suri)
      await this.setKeyValueLocked(
        db,
        realmName,
        suri,
        nextActor.getEventId() || origin,
        nextActor.getData(),
        nextActor.getOpt(),
        nextActor.getSid(),
        nextActor
      )
      const { value: curData } = await this.getStoredValue(db, realmName, suri)
      nextActor = await this.findNextWhenActor(realmName, suri, curData)
    }
  }

  // @return promise
  setKeyValue (realmName: string, suri: string, origin: string, data: any, opt: any, sid: string, pubOutEvent: (kind: string, outEvent: any) => void, actor?: IActorPush) {
    return this.pkq.enQueue(this.getWaitKey(realmName, suri), async () => {
      const db = await this.getDb(realmName)
      try {
        await this.setKeyValueLocked(db, realmName, suri, origin, data, opt, sid, actor)
        pubOutEvent('event', { sid })
      } catch (e: any) {
        console.error('SetKeyValue ERROR:', e.message, e.stack)
        throw e
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
  getKey (realmName: string, uri: string[], cbRow: (key: string[], data: any, updatedByMsgId: string) => void) {
    const strUri = restoreUri(uri)
    return this.pkq.enQueue(realmName + '|' + strUri, async () => {
      const db = await this.getDb(realmName)
      // TODO: optimize search
      await db.each(
        `SELECT key, value, opt, updated_by_msg_id FROM kv_${realmName}`,
        [],
        (err, row) => {
          const aKey: string[] = defaultParse(row.key)
          if (match(aKey, uri)) {
            const rowData = JSON.parse(row.value)
            cbRow(aKey, unSerializeData(rowData), row.updated_by_msg_id)
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
    return this.mod.eraseSessionData(this.realmName, sessionId, this.runInboundEvent.bind(this))
  }

  // @result promise
  setKeyActor (actor: IActorPush) {
    const suri = this.getStrUri(actor)
    const eventId = actor.getEventId()
    if (!eventId) {
      throw new Error("SetKeyActor: No eventId for actor " + actor.getUri().join("/"))
    }
    return this.mod.setKeyValue(
      this.realmName,
      suri,
      eventId,
      actor.getData(),
      actor.getOpt(),
      actor.getSid(),
      (kind:any, outEvent:any) => {},
      actor
    )
  }

  getKey (uri: string[], cbRow: (aKey: string[], data: any, eventId: any) => void): Promise<any> {
    return this.mod.getKey(this.realmName, uri, cbRow)
  }
}
