import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'
import { promises as fsp } from 'fs'
import path from 'path'

export class DbFactory {

  private activeDbs: Map<string, sqlite.Database>  // of database file
  private mainDb: sqlite.Database | null = null
  private pathPrefix: string = ''

  constructor (pathPrefix: string | null) {
    this.pathPrefix = pathPrefix || ''
    this.activeDbs = new Map()  // of database file
    this.mainDb = null
  }

  async openDatabase (filename: string): Promise<sqlite.Database> {
    const db = await sqlite.open({
      filename: filename,
      driver: sqlite3.Database
    })
    this.activeDbs.set(path.basename(filename), db)
    return db
  }

  async openMainDatabase (filename: string): Promise<sqlite.Database> {
    const db = await sqlite.open({
      filename: filename,
      driver: sqlite3.Database
    })
    this.mainDb = db
    return db
  }

  async getDb (realmName: string): Promise<sqlite.Database> {
    // TODO: find realm db
    return this.getMainDb()
  }

  getMainDb (): sqlite.Database {
    if (this.mainDb === null) {
      throw new Error('Main database is not set')
    }
    return this.mainDb
  }

  setMainDb (db: sqlite.Database): void {
    this.mainDb = db
  }

  async forEachDb (callback: (db: sqlite.Database, realmName: string) => Promise<void>): Promise<void> {
    const files = await fsp.readdir(this.pathPrefix)
    for (const filename of files) {
      if (path.extname(filename) !== '.sqlite') {
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
      const db: sqlite.Database | undefined = this.activeDbs.get(realmName)
      if (!db) {
        console.error('Database not found for realm:', realmName)
        continue
      }
      await callback(db, realmName)
    }
  }
}
