'use strict'

const { BaseEngine, DeferMap } = require('./realm')

class PromiseEngine extends BaseEngine {
  constructor (binder) {
    super()
    this.binder = binder
    this.qConfirm = new DeferMap()
  }

  storeInHistory (actor) {
    return this.binder.storeInHistory(this, actor)
  }

  storeOutHistory (actor) {
    return this.binder.storeOutHistory(this, actor)
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
