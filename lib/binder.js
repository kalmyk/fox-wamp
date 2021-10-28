'use strict'

const { BaseEngine, DeferMap } = require('./realm')

class ReactEngine extends BaseEngine {
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

  doPush (actor) {
    this.storeInHistory(actor).then(() => {
      if (actor.getOpt().retain) {
        this.updateKvFromActor(actor)
      } else {
        actor.confirm(actor.msg)
      }  
    })
  }

  cleanupSession(sessionId) {
    return Promise.all([
      super.cleanupSession(sessionId),
      this.binder.cleanupSession(this, sessionId)
    ])
  }
}

class ReactBinder {
  // getHistoryAfter(engine, after, uri, cbRow) abstract
  // cleanupSession(engine, sessionId)
}

exports.ReactEngine = ReactEngine
exports.ReactBinder = ReactBinder
