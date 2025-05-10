'use strict'

const { BaseRealm } = require('../realm')
const { DbEngine } = require('../sqlite/dbengine')
const { SqliteModKv, SqliteKv } = require('../sqlite/sqlitekv')
const FoxRouter = require('../fox_router')
const { keyDate, ProduceId } = require('../allot/makeid')

class OneDbRouter extends FoxRouter {

  constructor () {
    super()
    this.makeId = new ProduceId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()
    this.modKv = new SqliteModKv()
  }

  createRealm (realmName) {
    const realm = new BaseRealm(this, new DbEngine(this.getMakeId(), this.getModKv()))
    realm.registerKeyValueEngine(['#'], new SqliteKv(this.getModKv(), this.getMakeId(), realmName))
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
