'use strict'

class EntrySession {
  constructor (wampSession, syncMass) {
    this.wampSession = wampSession
    this.stack = []
    this.waitForValue = undefined
    this.syncMass = syncMass

    wampSession.subscribe('mkId', (publishArgs, kwargs, opts) => {
      this.sync(kwargs.bundleId)
    })

    wampSession.subscribe('ping', (publishArgs, kwargs, opts) => {
      wampSession.publish('pong', publishArgs, kwargs)
    })
  }

  sendToSync(bundleId) {
    console.log('mkId', bundleId)
    for (let [,ss] of this.syncMass) {
      ss.publish('mkId', [], {bundleId})
    }
  }

  checkLine() {
    if (this.waitForValue) {
      return false
    }
    this.waitForValue = this.stack.shift()
    if (this.waitForValue) {
      this.sendToSync(this.waitForValue)
      return true
    }
    return false
  }

  sync(bundleId) {
    this.stack.push(bundleId)
    return this.checkLine()
  }

  done(bundleId, syncId) {
    if (this.waitForValue === bundleId) {
      this.wampSession.publish('readyId', [], {bundleId, syncId})
      return this.checkLine()
    }
    return false
  }
}

exports.EntrySession = EntrySession
