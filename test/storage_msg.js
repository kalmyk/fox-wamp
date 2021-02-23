'use strict'

const chai     = require('chai')
const spies    = require('chai-spies')
const promised = require('chai-as-promised')
const assert   = chai.assert
chai.use(spies)
chai.use(promised)

const sqlite3 = require('sqlite3')
const sqlite = require('sqlite')
const Msg = require('../lib/sqlite/msg')


describe('message-storage', function () {
  let msg

  before(async function () {
    const db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    msg = new Msg(db)
    return db
  })

  beforeEach(function () {
  })

  afterEach(function () {
  })

  it('should create tables', function () {
    return assert.isFulfilled(msg.createTables())
  })

  it('should save message', function () {
    return assert.isFulfilled(msg.saveMsg(
      '12345678b11',
      'test-realm',
      ['msg', 'test', 'com'],
      {
        some_row_1: 'line1',
        some_row_2: 'line2'
      }
    ))
  })

  it('should get max message id', function () {
    return assert.becomes(
      msg.getMaxId('origin'),
      '12345678b11'
    )
  })
})
