'use strict'

const { AbstractBinder, BaseEngine } = require('./realm')

class ReactEngine extends BaseEngine {
  constructor (binder, realmName) {
    super()
    this.binder = binder
    this.realmName = realmName    
  }

  getRealmName() {
    return this.realmName
  }

  doPush (actor) {
    this.toMakeId.push(actor)
    this.binder.doPush(this, actor)
  }

  getHistoryAfter (after, uri, cbRow) {
    return this.binder.getHistoryAfter(this, after, uri, cbRow)
  }
}

class ReactBinder extends AbstractBinder {
  // getHistoryAfter(engine, after, uri, cbRow) abstract
}

exports.ReactEngine = ReactEngine
exports.ReactBinder = ReactBinder
