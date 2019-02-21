'use strict'

// requires sender with
// sender.send(msg, callback)
// sender.close(code, reason)

function Session (gate, sender, sessionId) {
  this.realmName = undefined
  this.secureDetails = undefined
  this.authmethod = 'anonymous'

  this.realm = null
  this.gate = gate
  this.sessionId = sessionId

  let simultaneousTaskLimit = 1
  let tasksRequested = 0

  /**
     trace commands
    [id] => actor
  */
  let sTrace = new Map()

  /**
     subscribtion commands
    [id] => actor
  */
  let sSub = new Map()

  /**
    use realm.joinSession to connect to the realm
  */
  this.setRealm = function (realm) {
    this.realm = realm
  }

  this.taskResolved = function () {
    tasksRequested--
  }

  this.taskRequested = function () {
    tasksRequested++
  }

  this.isAble = function () {
    return (simultaneousTaskLimit - tasksRequested) > 0
  }

  this.checkWaitTask = function (engine) {
    let found = false
    if (this.isAble()) {
      for (let [key, subD] of sSub) {
        found = found || engine.checkTasks(subD)
        if (!this.isAble()) {
          return found // exit is worker got enough tasks
        }
      }
    }
    return found
  }

  this.addTrace = function (id, actor) {
    sTrace.set(id, actor)
  }

  this.removeTrace = function (engine, id) {
    let actor = false
    if (sTrace.has(id)) {
      actor = sTrace.get(id)
      sTrace.delete(id)
      engine.removeTrace(actor.getUri(), actor)
    }
    return actor
  }

  this.cleanupTrace = function (engine) {
    let tmp = []
    let deletedCount = 0
    for (let [key, subD] of sTrace) {
      tmp.push(key)
      deletedCount++
    }
    for (let i = 0; i < tmp.length; i++) {
      this.removeTrace(engine, tmp[i])
    }
    sTrace.clear()
    return deletedCount
  }

  this.addSub = function (id, subD) {
    sSub.set(id, subD)
  }

  this.removeSub = function (engine, id) {
    let actor = false
    if (sSub.has(id)) {
      actor = sSub.get(id)
      sSub.delete(id)
      engine.removeSub(actor.getUri(), id)
    }
    return actor
  }

  this.cleanupReg = function (engine) {
    let tmp = []
    let deletedCount = 0
    for (let [key, subD] of sSub) {
      tmp.push(key)
      deletedCount++
    }
    for (let i = 0; i < tmp.length; i++) {
      this.removeSub(engine, tmp[i])
    }
    return deletedCount
  }

  this.handle = function (msg) {
    // console.log(this.sessionId, '>', msg)
    gate.handle(this, msg)
  }

  this.send = function (msg, callback) {
    // console.log(this.sessionId, '<', msg)
    sender.send(msg, callback)
  }

  this.acknowledged = function (cmd) {
    // this here to have one point to enable trace
    gate.acknowledged(this, cmd)
  }

  this.close = function (code, reason) {
    sender.close(code, reason)
  }

  this.cleanup = function () {
    if (this.realm) {
      this.realm.cleanupSession(this)
    }
  }

  this.getGateProtocol = function () {
    return gate.getProtocol()
  }

  this.getRealmInfo = function () {
    if (this.realm) {
      return this.realm.getInfo()
    } else {
      return {}
    }
  }
}

module.exports = Session
