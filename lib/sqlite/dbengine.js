'use strict'

const { makeDataSerializable, unSerializeData } = require('../realm')
const { BaseEngine } = require('../realm')
const History = require('./history')
const { getDbFactoryInstance } = require('./dbfactory')
const { createKvTables }    = require('./sqlitekv')

class DbEngine extends BaseEngine {

  constructor (idMill, modKv) {
    super()
    this.idMill = idMill
    this.modKv = modKv
  }

  async launchEngine (realmName) {
    await super.launchEngine(realmName)

    const dbFactory = getDbFactoryInstance()
    await History.createHistoryTables(dbFactory.getMainDb(), realmName)
    await createKvTables(dbFactory.getMainDb(), realmName)
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

  async saveHistory (actor) {
    const id = this.idMill.generateIdStr()
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
