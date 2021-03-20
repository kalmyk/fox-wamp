'use strict'

const { match, extract, defaultParse, restoreUri } = require('../topic_pattern')
const errorCodes = require('../realm_error').errorCodes
const { KeyValueStorageAbstract, isDataFit } = require('../realm')

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
    const suri = restoreUri(extract(actor.getUri(), this.getUriPattern()))

    // let oldSid
    // let oldWill
    let oldData = null
    let resWhen = []

    const findNextWhenActor = (curData) => {
      for (let i = 0; i < resWhen.length; i++) {
        const whenActor = resWhen[i]
        if (!whenActor.isActive()) {
          resWhen.splice(i, 1)
          i--
          continue
        }
        if (isDataFit(whenActor.getOpt().when, curData)) {
          resWhen.splice(i, 1)
          return whenActor
        }
      }
      return false
    }

    const pubWhile = (newActor) => {
      do {
        const newOpt = newActor.getOpt()
        const newData = newActor.getData()
        const willSid = ('will' in newOpt) ? newActor.getSid() : null
        this.keepHistory(newActor)
        if (newData === null) {
          this._keyDb.delete(suri)
        } else {
          this._keyDb.set(suri, [willSid, newData, newOpt.will, resWhen])
        }
        newActor = findNextWhenActor(newActor.getData())
      } while (newActor)
    }

    const opt = actor.getOpt()
    const oldRow = this._keyDb.get(suri)
    if (oldRow) {
      [/* oldSid */, oldData, /* oldWill */, resWhen] = oldRow
    }

    if ('when' in opt) {
      if (isDataFit(opt.when, oldData)) {
        pubWhile(actor)
        return
      } else if (opt.watch) {
        resWhen.push(actor)
        return
      } else {
        actor.reject(errorCodes.ERROR_INVALID_PAYLOAD, 'not accepted')
        return
      }
    }
    // no when publish
    pubWhile(actor)
  }

  removeSession (sessionId) {
    let toRemove = []
    for (const [key, value] of this._keyDb) {
      const resWhen = value[3]
      for (let i = resWhen.length - 1; i >= 0; i--) {
        const whenActor = resWhen[i]
        if (whenActor.getSid() === sessionId) {
          resWhen.splice(i, 1)
        }
      }

      const keySessionId = value[0]
      if (keySessionId === sessionId) {
        toRemove.push(key)
      }
    }
    for (let i = 0; i < toRemove.length; i++) {
      const key = toRemove[i]
      const row = this._keyDb.get(key)
      const will = row[2]
      if (will) {
        this.setKeyData(key, will)
      } else {
        this.setKeyData(key, null)
      }
    }
  }
}

exports.MemKeyValueStorage = MemKeyValueStorage
