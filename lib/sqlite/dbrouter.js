'use strict'

const tools = require('../tools')
const { makeDataSerializable, unSerializeData, BaseRealm } = require('../realm')
const { ReactEngine, ReactBinder } = require('../binder')

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

  keepHistory (engine, actor) {
    const id = tools.keyDate(new Date()) + tools.keyId(++this._messageGen)
    actor.setEventId(id)

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
