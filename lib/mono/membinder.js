'use strict'

const { match, intersect, merge, extract } = require('../topic_pattern')
const { AbstractBinder, BaseEngine, BaseRealm } = require('../realm')
const { MemKeyValueStorage } = require('./memkv')

class MemEngine extends BaseEngine {
  constructor () {
    super()
    this._messageGen = 0
    this._messages = []
    this._kvo = [] // key value order
  }

  setKeyActor (actor) {
    const uri = actor.getUri()
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      const kvr = this._kvo[i]
      if (match(uri, kvr.uri)) {
        kvr.kv.setKeyActor(actor)
        break
      }
    }
  }

  memPush (actor) {
    actor.setEventId(++this._messageGen)

    actor.destSID = this.dispatch(actor.getEvent())
    this.actorConfirm(actor, actor.msg)

    if (actor.getOpt().trace) {
      this._messages.push(actor.getEvent())
      if (this._messages.length > 10100) {
        this._messages = this._messages.splice(100)
      }
    }
  }

  doPush (actor) {
    if (actor.getOpt().retain) {
      this.setKeyActor(actor)
    } else {
      this.memPush(actor)
    }
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

  getKey (uri, cbRow) {
    const done = []
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      const kvr = this._kvo[i]
      // console.log('MATCH++', uri, kvr.uri, extract(uri, kvr.uri))
      if (intersect(uri, kvr.uri)) {
        done.push(kvr.kv.getKey(
          extract(uri, kvr.uri),
          (aKey, data) => {
            cbRow(merge(aKey, kvr.uri), data)
          }
        ))
      }
    }
    return Promise.all(done)
  }

  setKeyData (uri, data) {
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      const kvr = this._kvo[i]
      if (match(uri, kvr.uri)) {
        kvr.kv.setKeyData(extract(uri, kvr.uri), data)
        break
      }
    }
  }

  registerKeyValueEngine (uri, kv) {
    kv.setUriPattern(uri)
    kv.pubActor = (actor) => {
      this.memPush (actor)
    }
    kv.confirm = (actor, cmd) => {
      actor.confirm(cmd)
    }
    this._kvo.push({ uri, kv })
  }

  cleanupSession(sessionId) { // override
    for (let i = this._kvo.length - 1; i >= 0; i--) {
      this._kvo[i].kv.removeSession(sessionId)
    }
  }
}

class MemRealm extends BaseRealm {
  registerKeyValueEngine (uri, kv) {
    return this.engine.registerKeyValueEngine(uri, kv)
  }
}

class MemBinder extends AbstractBinder {
  createRealm (router) {
    const engine = new MemEngine()
    engine.registerKeyValueEngine(['#'], new MemKeyValueStorage())

    return new MemRealm(
      router,
      engine
    )
  }
}
  
exports.MemEngine = MemEngine
exports.MemKeyValueStorage = MemKeyValueStorage
exports.MemBinder = MemBinder
