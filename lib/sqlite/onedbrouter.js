'use strict'

const { BaseRealm } = require('../realm')
const { DbEngine } = require('../sqlite/dbengine')
const { SqliteKvFabric, SqliteKv } = require('../sqlite/sqlitekv')
const FoxRouter = require('../fox_router')
const { keyDate, ProduceId } = require('../masterfree/makeid')

class OneDbRouter extends FoxRouter {

  constructor (dbFactory) {
    super()
    this.makeId = new ProduceId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()
    this.modKv = new SqliteKvFabric(dbFactory, this.makeId)
  }

  createRealm (realmName) {
    const realm = new BaseRealm(this, new DbEngine(this.getMakeId(), this.getModKv()))
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.getModKv(), realmName))
    return realm
  }

  getMakeId () {
    return this.makeId
  }

  getModKv () {
    return this.modKv
  }

  startActualizePrefixTimer () {  
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 60000)
  }
}

exports.OneDbRouter = OneDbRouter
