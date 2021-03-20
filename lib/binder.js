'use strict'

const { AbstractBinder, BaseEngine, DeferMap } = require('./realm')

class ReactEngine extends BaseEngine {
  constructor (binder) {
    super()
    this.binder = binder
    this.qConfirm = new DeferMap()
  }

  keepHistory (actor) {
    return this.binder.keepHistory(this, actor)
  }

  getHistoryAfter (after, uri, cbRow) {
    return this.binder.getHistoryAfter(this, after, uri, cbRow)
  }

  cleanupSession(sessionId) {
    return this.binder.cleanupSession(this, sessionId)
  }
}

class ReactBinder extends AbstractBinder {
  // getHistoryAfter(engine, after, uri, cbRow) abstract
  // cleanupSession(engine, sessionId)
}

exports.ReactEngine = ReactEngine
exports.ReactBinder = ReactBinder
