'use strict'

const { makeDataSerializable, unSerializeData } = require('../realm')
const { BaseEngine } = require('../realm')
const History = require('./history')
const { getDbFactoryInstance } = require('./dbfactory')

class DbEngine extends BaseEngine {

  async launchEngine (realmName) {
    await super.launchEngine(realmName)

    const dbFactory = getDbFactoryInstance()
    await History.createTables(dbFactory.getMainDb(), realmName)
    this.idMill = dbFactory.getMakeId()
  }

  // @return promise
  doPush (actor) {
    return this.saveHistory(actor).then(() => {
      this.disperseToSubs(actor.getEvent())
      if (actor.getOpt().retain) {
        return this.updateKvFromActor(actor)
      } else {
        actor.confirm(actor.msg)
        return Promise.resolve()
      }
    })
  }

  parseId (encodedId) {
    let newDateStr = encodedId.substr(0, 10)
    let intLen = encodedId.charCodeAt(10) - 96
    let newId = parseInt(encodedId.substr(11, intLen), 36)
    this.idMill.reconcilePos(newDateStr, newId)
  }

  async saveHistory (actor) {
    const id = this.idMill.makeIdStr()
    actor.setEventId(id)

    if (actor.getOpt().trace) {
      return History.saveEventHistory(
        getDbFactoryInstance().getMainDb(),
        this.getRealmName(),
        id,
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    }
  }

  async getHistoryAfter (after, uri, cbRow) {
    return History.getEventHistory(
      getDbFactoryInstance().getMainDb(),
      this.getRealmName(),
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

exports.DbEngine = DbEngine
