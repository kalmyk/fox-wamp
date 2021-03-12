'use strict'

const { merge, match, extract, defaultParse, restoreUri } = require('../topic_pattern')
const errorCodes = require('../realm_error').errorCodes
const { isDataFit } = require('../realm')

class ActorPushKv {
  constructor (uri, data, opt) {
    this.uri = uri
    this.data = data
    this.opt = opt
    this.eventId = null
  }

  getOpt () {
    return Object.assign({}, this.opt)
  }

  getUri () {
    return this.uri
  }

  getSid() {
    return this.opt.sid
  }

  getData () {
    return this.data
  }

  setEventId (id) {
    this.eventId = id
  }

  getEvent () {
    return {
      qid: this.eventId,
      uri: this.getUri(),
      data: this.getData(),
      opt: this.getOpt()
    }
  }

  confirm () {}
}

class KeyValueStorageAbstract {
  constructor () {
    this.uriPattern = '#'
  }

  setUriPattern (uriPattern) {
    this.uriPattern = uriPattern
  }

  getUriPattern () {
    return this.uriPattern
  }

  // pubActor (actor) virtual abstract

  setKeyData (key, data) {
    this.setKeyActor(
      new ActorPushKv(
        merge(key, this.uriPattern),
        data,
        {})
    )
  }

  // Promise:getKey (uri, cbRow) ::cbRow:: aKey, data
  // removeSession (sessionId)
}

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

    const findWhenActor = (curActor) => {
      for (let i = 0; i < resWhen.length; i++) {
        const whenActor = resWhen[i]
        if (!whenActor.isActive()) {
          resWhen.splice(i, 1)
          i--
          continue
        }
        if (isDataFit(whenActor.getOpt().when, curActor.getData())) {
          resWhen.splice(i, 1)
          return whenActor
        }
      }
      return false
    }

    const pub = (newActor) => {
      do {
        const newOpt = newActor.getOpt()
        const newData = newActor.getData()
        const willSid = 'will' in newOpt ? newActor.getSid() : null
        this.pubActor(newActor)
        if (newData === null) {
          this._keyDb.delete(suri)
        } else {
          this._keyDb.set(suri, [willSid, newData, newOpt.will, resWhen])
        }
        newActor = findWhenActor(newActor)
      } while (newActor)
    }

    const opt = actor.getOpt()
    const oldRow = this._keyDb.get(suri)
    if (oldRow) {
      [/* oldSid */, oldData, /* oldWill */, resWhen] = oldRow
    }

    if ('when' in opt) {
      if (isDataFit(opt.when, oldData)) {
        pub(actor)
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
    pub(actor)
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

exports.KeyValueStorageAbstract = KeyValueStorageAbstract
exports.ActorPushKv = ActorPushKv
exports.MemKeyValueStorage = MemKeyValueStorage
