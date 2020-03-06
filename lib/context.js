'use strict'

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

class Context {
  constructor (router, session, sender) {
    this.router = router
    this.session = session
    this.sender = sender
  }

  getSession () {
    return this.session
  }

  isActive () {
    return this.session.isActive()
  }

  emit (event, message, data) {
    this.router.emit(event, this.session, message, data)
  }
}

module.exports = Context
