'use strict'

const { keyDate, MakeId } = require('../allot/makeid')
const { makeDataSerializable, unSerializeData, DeferMap } = require('../realm')
const { PromiseEngine, PromiseBinder } = require('../binder')
const { History } = require('./history')

class DbEngine extends PromiseEngine {
  constructor (binder) {
    super(binder)
    this.qConfirm = new DeferMap()
  }

  // @return promise
  doPush (actor) {
    return this.saveInboundHistory(actor).then(() => {
      this.disperseToSubs(actor.getEvent())
      if (actor.getOpt().retain) {
        return this.updateKvFromActor(actor)
      } else {
        actor.confirm(actor.msg)
        return Promise.resolve()
      }
    })
  }
}

class DbBinder extends PromiseBinder {
  constructor (db) {
    super()
    this.dbHistory = new History(db)
    this.makeId = new MakeId(() => keyDate(new Date()))
    this.makeId.update()
  }

  startIntervalTimer () {
    setInterval(() => {
      this.makeId.update()
    }, 60000)
  }

  async init () {
    await this.dbHistory.createTables()
    let curId = await this.dbHistory.getMaxId()
    if (curId) {
      this.parseId(curId)
    }
    return curId
  }

  parseId (encodedId) {
    let newDateStr = encodedId.substr(0, 10)
    let intLen = encodedId.charCodeAt(10) - 96
    let newId = parseInt(encodedId.substr(11, intLen), 36)
    this.makeId.reconcilePos(newDateStr, newId)
  }

  getMakeId () {
    return this.makeId
  }

  saveHistory (engine, actor) {
    const id = this.makeId.makeIdStr()
    actor.setEventId(id)

    let result
    if (actor.getOpt().trace) {
      result = this.dbHistory.saveEventHistory(
        id,
        engine.getRealmName(),
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    } else {
      result = Promise.resolve()
    }
    return result
  }

  getHistoryAfter (engine, after, uri, cbRow) {
    return this.dbHistory.getEventHistory(
      engine.getRealmName(),
      { fromId: after, uri },
      (event) => {
        cbRow({
          qid: event.id,
          uri: event.uri,
          data: unSerializeData(event.body)
        })
      }
    )
  }

  cleanupSession (engine, sessionId) {
    return Promise.resolve(true)
  }
}

exports.DbEngine = DbEngine
exports.DbBinder = DbBinder
