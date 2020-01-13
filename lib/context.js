'use strict'

class Context {
  constructor (router, session) {
    this.router = router
    this.id = undefined
    this.session = session
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

  emit (event, obj, message, data) {
    this.router.emit(event, obj, message, data)
  }
}

module.exports = Context
