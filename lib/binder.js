'use strict'

const { AbstractBinder, BaseEngine } = require('./realm')

class ReactEngine extends BaseEngine {
  constructor (binder) {
    super()
    this.binder = binder
  }

  doPush (actor) {
    return this.binder.doPush(this, actor)
  }

  getHistoryAfter (after, uri, cbRow) {
    return this.binder.getHistoryAfter(this, after, uri, cbRow)
  }

  cleanupSession(sessionId) { // override
    return this.binder.cleanupSession(this, sessionId)
  }
}

class ReactBinder extends AbstractBinder {
  // getHistoryAfter(engine, after, uri, cbRow) abstract
  // cleanupSession(engine, sessionId)
}

exports.ReactEngine = ReactEngine
exports.ReactBinder = ReactBinder
