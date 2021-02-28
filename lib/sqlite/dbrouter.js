'use strict'

const tools = require('../tools')
const { makeDataSerializable, unSerializeData, BaseRealm } = require('../realm')
const BaseEngine = require('../realm').BaseEngine
const { ReactEngine, ReactBinder } = require('../binder')

class DbEngine extends BaseEngine {
  constructor (msg) {
    super()
    this._messageGen = 0
    this.msg = msg
  }

  doPush (actor) {
    const id = tools.keyDate(new Date()) + tools.keyId(++this._messageGen)
    actor.setEventId(id)
    super.doPush(actor)
    if (actor.getOpt().trace) {
      this.msg.saveMsg(
        id,
        this.realmName,
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    }
  }
}

class DbBinder extends ReactBinder {
  constructor (msg) {
    super()
    this.msg = msg
    this._messageGen = 0
  }

  createRealm (router, realmName) {
    const engine = new ReactEngine(this, realmName)
    const realm = new BaseRealm(router, engine)
    return realm
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
}

exports.DbBinder = DbBinder
exports.DbEngine = DbEngine
