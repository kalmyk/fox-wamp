'use strict'

const tools = require('../tools')
const { makeDataSerializable, unSerializeData } = require('../realm')
const { ReactBinder } = require('../binder')
const Msg = require('./msg')

class DbBinder extends ReactBinder {
  constructor (db) {
    super()
    this.msg = new Msg(db)
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
    } else if (newDateStr = this.dateStr && newId > this._messageGen) {
      this._messageGen = newId
    }
  }

  getNewId () {
    return this.dateStr + tools.keyId(++this._messageGen)
  }

  keepHistory (engine, actor) {
    const id = this.getNewId()
    actor.setEventId(id)
    // console.log("getNewId", id, actor.getEvent())

    let result
    if (actor.getOpt().trace) {
      result = this.msg.saveMsg(
        id,
        engine.getRealmName(),
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    } else {
      result = Promise.resolve()
    }
    result.then(() => {
      actor.destSID = engine.dispatch(actor.getEvent())
      actor.confirm(actor.msg)
    })
  }

  getHistoryAfter (engine, after, uri, cbRow) {
    return this.msg.getHistory(
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
  }
}

exports.DbBinder = DbBinder
