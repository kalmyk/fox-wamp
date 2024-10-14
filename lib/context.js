'use strict'

// abstract to implement
// sendInvoke
// sendResult
// sendEvent
// sendAck
// sendError

class Context {
  constructor (router, session) {
    this.router = router
    this.session = session
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

  setSendFailed (e) {
    this.session.setSendFailed(e)
  }
}

module.exports = Context
