'use strict'

const { match } = require('../topic_pattern')
const { BaseEngine } = require('../realm')

class MemEngine extends BaseEngine {
  constructor () {
    super()
    this._messageGen = 0
    this._messages = []
  }

  keepHistory (actor) {
    actor.setEventId(++this._messageGen)

    if (actor.getOpt().trace) {
      this._messages.push(actor.getEvent())
      if (this._messages.length > 10100) {
        this._messages = this._messages.splice(100)
      }
    }

    actor.destSID = this.dispatch(actor.getEvent())
    actor.confirm(actor.msg)
  }

  getHistoryAfter (after, uri, cbRow) {
    return new Promise((resolve, reject) => {
      for (let i = 0; i < this._messages.length; i++) {
        const event = this._messages[i]
        if (event.qid > after && match(event.uri, uri)) {
          cbRow(event)
        }
      }
      resolve()
    })
  }
}

exports.MemEngine = MemEngine
