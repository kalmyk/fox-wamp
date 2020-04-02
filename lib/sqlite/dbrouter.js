'use strict'

const tools = require('../tools')
const FoxRouter = require('../fox_router')
const { makeDataSerializable, unSerializeData, BaseRealm } = require('../realm')
const BaseEngine = require('../realm').BaseEngine
const MemKeyValueStorage = require('../memkv').MemKeyValueStorage

class DbEngine extends BaseEngine {
  constructor (msg, realmName) {
    super()
    this._messageGen = 0
    this.msg = msg
    this.realmName = realmName
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

  getHistoryAfter (after, uri, cbRow) {
    return this.msg.getHistory(
      this.realmName,
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

class DbRouter extends FoxRouter {
  constructor (msg) {
    super()
    this.msg = msg
  }

  createRealm (realmName) {
    const engine = new DbEngine(this.msg, realmName)
    const realm = new BaseRealm(this, realmName, engine)
    realm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
    return realm
  }
}

exports.DbRouter = DbRouter
exports.DbEngine = DbEngine
