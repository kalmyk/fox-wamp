'use strict'

const { EventEmitter } = require('events')

class SessionEntrySync extends EventEmitter {
  constructor (wampSession) {
    super()
  }
}

exports.SessionEntrySync = SessionEntrySync
