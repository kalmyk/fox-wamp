'use strict'

const { match, extract, defaultParse, restoreUri } = require('./topic_pattern')
const errorCodes = require('./realm_error').errorCodes
const KeyValueStorageAbstract = require('./realm').KeyValueStorageAbstract

class MemKeyValueStorage extends KeyValueStorageAbstract {
  constructor () {
    super()
    this._keyDb = new Map()
  }

  getKey (uri, cbRow) {
    return new Promise((resolve, reject) => {
      for (let [key, item] of this._keyDb) {
        const aKey = defaultParse(key)
        if (match(aKey, uri)) {
          cbRow(aKey, item[1] /* data */)
        }
      }
      resolve()
    })
  }

  setKeyActor (actor) {
    const opt = actor.getOpt()
    const suri = restoreUri(extract(actor.getUri(), this.getUriPattern()))
    const data = actor.getData()

    const pub = () => {
      if (actor) {
        this.pubActor(actor)
      }
      if (data === null) {
        this._keyDb.delete(suri)
      } else {
        this._keyDb.set(suri, [actor.getSid(), data])
      }
    }
    const row = this._keyDb.get(suri)

    if ('when' in opt) {
      if (opt.when === null) {

        if (undefined === row) {
          pub()
          return
        }
        const [sid, val, when] = row

        if (val === null) {
          pub()
          return
        }

        actor.reject(errorCodes.ERROR_INVALID_PAYLOAD, 'Found value is not empty')
        return
      }

      if (undefined !== row) {
        const [sid, val, when] = row
        if (val !== null) {
          pub()
          return
        }
      }
      actor.reject(errorCodes.ERROR_INVALID_PAYLOAD, 'Value is empty')
      return
    }

    pub()
  }

  removeSession (sessionId) {
    let toRemove = []
    for (let key in this._keyDb) {
      const keySessionId = this._keyDb.get(key)[0]
      if (keySessionId === sessionId) {
        toRemove.push(key)
      }
    }
    for (let i = 0; i < toRemove.length; i++) {
      this.setKeyData(toRemove[i], null)
    }
  }
}

exports.MemKeyValueStorage = MemKeyValueStorage
