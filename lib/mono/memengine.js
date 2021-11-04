'use strict'

const { match } = require('../topic_pattern')
const { BaseEngine } = require('../realm')

/* store event history in memory */

class MemEngine extends BaseEngine {
  constructor () {
    super()
    this._messageGen = 0
    this._inMsg = []
    this._outMsg = []
  }

  keepHistory (msgStore, actor) {
    actor.setEventId(++this._messageGen)
  
    if (actor.getOpt().trace) {
      msgStore.push(actor.getEvent())
      if (msgStore.length > 10100) {
        msgStore.splice(0,100)
      }
    }
  
    actor.destSID = this.dispatch(actor.getEvent())
  }
  
  storeInHistory (actor) {
    this.keepHistory(this._inMsg, actor)
  }

  storeOutHistory (actor) {
    this.keepHistory(this._outMsg, actor)
  }

  getHistoryAfter (after, uri, cbRow) {
    return new Promise((resolve, reject) => {
      for (let i = 0; i < this._inMsg.length; i++) {
        const event = this._inMsg[i]
        if (event.qid > after && match(event.uri, uri)) {
          cbRow(event)
        }
      }
      resolve()
    })
  }

  getInMessagesCount () {
    return this._inMsg.length
  }
}

exports.MemEngine = MemEngine
