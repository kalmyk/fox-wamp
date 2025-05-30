import chai, { expect, assert } from 'chai'
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'
import History from '../lib/sqlite/history.js'

describe('30 message-storage', async () => {
  let db

  before(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    return db
  })

  beforeEach(async () => {
  })

  afterEach(async () => {
  })

  it('should create tables', async () => {
    return assert.isFulfilled(History.createHistoryTables(db, 'testrealm'))
  })

  it('should save message', async () => {
    return assert.isFulfilled(History.saveEventHistory(
      db,
      'testrealm',
      '12345678b11',
      ['msg', 'test', 'com'],
      {
        some_row_1: 'line1',
        some_row_2: 'line2'
      },
      {opt1: 'define-option'}
    ))
  })

  it('should get max message id', async () => {
    return assert.becomes(
      History.scanMaxId(db),
      '12345678b11'
    )
  })

  it('should get message from db', async () => {
    let result = []
    await assert.becomes(
      History.getEventHistory(
        db,
        'testrealm',
        {uri:['msg', 'test', 'com'],fromId:'12345678b10'},
        (row) => {result.push(row)}
      ),
      1
    )
    expect([{
      id: '12345678b11',
      uri: ['msg', 'test', 'com'],
      body: {
        some_row_1: 'line1',
        some_row_2: 'line2'
      },
      opt: {opt1: 'define-option'}
    }]).to.deep.equal(result)
  })
})
