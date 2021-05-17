'use strict'

const tools = require('../tools')
const { makeDataSerializable, unSerializeData } = require('../realm')
const { ReactBinder } = require('../binder')
const { History } = require('./history')

class DbBinder extends ReactBinder {
  constructor (db) {
    super()
    this.msg = new History(db)
    this._messageGen = 0
    this.dateStr = tools.keyDate(new Date())
  }

  startIntervalTimer () {
    setInterval(() => {
      let dateStr = tools.keyDate(new Date())
      if (dateStr > this.dateStr) {
        this._messageGen = 0
      }
    }, 60000)
  }

  async init () {
    await this.msg.createTables()
    let curId = await this.msg.getMaxId()
    if (curId) {
      this.parseId(curId)
    }
    return curId
  }

  parseId (encodedId) {
    let newDateStr = encodedId.substr(0, 10)
    let intLen = encodedId.charCodeAt(10) - 96
    let newId = parseInt(encodedId.substr(11, intLen), 36)
    if (newDateStr > this.dateStr) {
      this._messageGen = newId
    } else if (newDateStr == this.dateStr && newId > this._messageGen) {
      this._messageGen = newId
    }
  }

  getNewId () {
    return this.dateStr + tools.keyId(++this._messageGen)
  }

  keepHistory (saver, engine, actor) {
    const id = this.getNewId()
    actor.setEventId(id)

    let result
    if (actor.getOpt().trace) {
      result = saver(
        id,
        undefined, // origin
        engine.getRealmName(),
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    } else {
      result = Promise.resolve()
    }
    result.then(() => {
      actor.destSID = engine.dispatch(actor.getEvent())
    })
    return result
  }

  keepEventHistory (engine, actor) {
    return this.keepHistory(this.msg.saveEventHistory.bind(this.msg), engine, actor)
  }

  keepUpdateHistory (engine, actor) {
    return this.keepHistory(this.msg.saveUpdateHistory.bind(this.msg), engine, actor)
  }

  getHistoryAfter (engine, after, uri, cbRow) {
    return this.msg.getEventHistory(
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

  cleanupSession(engine, sessionId) {
    return Promise.resolve(true)
  }
}

exports.DbBinder = DbBinder
