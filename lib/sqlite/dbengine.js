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

    const db = await this.modKv.getDb(realmName)
    await History.createHistoryTables(db, realmName)
    await createKvTables(db, realmName)
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
      const db = await this.modKv.getDb(this.getRealmName())
      return History.saveEventHistory(
        db,
        this.getRealmName(),
        id,
        actor.getUri(),
        makeDataSerializable(actor.getData())
      )
    }
  }

  async getHistoryAfter (after, uri, cbRow) {
    const db = await this.modKv.getDb(this.getRealmName())
    return History.getEventHistory(
      db,
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
