'use strict'

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

const RealmError = require('./realm_error').RealmError

class Context {
  constructor (router, session, sender) {
    this.router = router
    this.id = undefined
    this.session = session
    this.sender = sender
  }

  getSession () {
    return this.session
  }

  setId (id) {
    this.id = id
  }

  getId () {
    return this.id
  }

  emit (event, message, data) {
    this.router.emit(event, this.session, message, data)
  }

  error(id, code, msg) {
    throw new RealmError(this.getId(), code, msg)
  }
}

module.exports = Context
