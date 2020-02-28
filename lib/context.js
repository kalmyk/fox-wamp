'use strict'

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

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
}

module.exports = Context
