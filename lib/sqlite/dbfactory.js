'use strict'

const { keyDate, MakeId } = require('../allot/makeid')
 
const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const fsp = require('fs').promises
const path = require('path')

class DbFactory {
  constructor () {
    // this.pathPrefix = pathPrefix
    this.activeDbs = new Map()  // of database file
    this.makeId = new MakeId(() => keyDate(new Date()))
    this.makeId.actualizePrefix()

    this.mainDb = null
  }

  async openMainDatabase (filename) {
    const db = await sqlite.open({
      filename: filename,
      driver: sqlite3.Database
    })
    this.mainDb = db
    return db
  }

  getMainDb () {
    return this.mainDb
  }

  setMainDb (db) {
    this.mainDb = db
  }

  getMakeId () {
    return this.makeId
  }

  async forEachDb (callback) {
    const files = await fsp.readdir(this.pathPrefix)
    for (const filename of files) {
      if (!path.extname(filename) === '.sqlite') {
        continue
      }
      const realmName = path.basename(filename, '.sqlite')
      if (!this.activeDbs.has(filename)) {
        console.log('open db', this.pathPrefix + filename)
        this.activeDbs.set(
          realmName,
          await this.openDatabase(this.pathPrefix + filename)
        )
      }
      await callback(this.activeDbs.get(realmName), realmName)
    }
  }

  startActualizePrefixTimer () {
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 60000)
  }
}

let dbFactoryInstance = null

function getDbFactoryInstance () {
  if (!dbFactoryInstance) {
    throw new Error('DbFactory not initialized')
  }
  return dbFactoryInstance
}

function setDbFactoryInstance (dbFactory) {
  return dbFactoryInstance = dbFactory
}

function initDbFactory (pathPrefix) {
  return setDbFactoryInstance(new DbFactory(pathPrefix))
}

exports.DbFactory = DbFactory
exports.initDbFactory = initDbFactory
exports.getDbFactoryInstance = getDbFactoryInstance
exports.setDbFactoryInstance = setDbFactoryInstance
