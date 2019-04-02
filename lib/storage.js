'use strict'

const { match, defaultParse, restoreUri } = require('./topic_pattern')

class Storage {
  constructor () {
    this.db = new Map()
  }

  setKey (uri, sessionId, data, messageId) {
    if (data === null) {
      this.removeKey(uri)
    } else {
      this.db.set(restoreUri(uri), [sessionId, data, messageId])
    }
  }

  getKey (cbRow, cbDone, uri) {
    for (let [key, item] of this.db) {
      let aKey = defaultParse(key)
      if (match(aKey, uri)) {
        cbRow(aKey, item[1] /* data */, item[2]/* messageId */)
      }
    }
    cbDone()
  }

  removeKey (key) {
    this.db.delete(restoreUri(key))
  }

  removeSession (sessionId) {
    let toRemove = []
    for (let key in this.db) {
      let keySessionId = this.db.get(key)[0]
      if (keySessionId === sessionId) {
        toRemove.push(key)
      }
    }
    for (let i = 0; i < toRemove.length; i++) {
      this.removeKey(toRemove[i])
    }
  }
}

module.exports = Storage
