'use strict'

const { BaseEngine, DeferMap } = require('./realm')

// base class for net & db
class PromiseEngine extends BaseEngine {
  constructor (binder) {
    super()
    this.binder = binder
    this.qConfirm = new DeferMap()
  }

  arrangeEvent (actor) {
    return this.binder.saveHistory(this, actor)
  }

  saveChangeHistory (actor) {
    throw Error('not implemented')
  }

  getHistoryAfter (after, uri, cbRow) {
    return this.binder.getHistoryAfter(this, after, uri, cbRow)
  }

  cleanupSession (sessionId) {
    return Promise.all([
      super.cleanupSession(sessionId),
      this.binder.cleanupSession(this, sessionId)
    ])
  }
}

class PromiseBinder {
  // getHistoryAfter(engine, after, uri, cbRow) abstract
  // cleanupSession(engine, sessionId)
}

exports.PromiseEngine = PromiseEngine
exports.PromiseBinder = PromiseBinder
