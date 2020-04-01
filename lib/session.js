'use strict'

function Session (gate, sessionId) {
  this.realmName = undefined
  this.secureDetails = undefined
  this.authmethod = 'unknown'

  this.realm = null
  this.sessionId = sessionId

  let willPublishCtx = undefined
  let willPublishCmd = undefined
  let sessionMsgId = 0
  let lastPublishedId = ''
  let publishMap = new Map()
  let userDetails = {}
  let active = true

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

  this.setAuthMethod = function (method) {
    this.authmethod = method
  }

  this.getAuthMethod = function () {
    return this.authmethod
  }

  this.setUserDetails = function (details) {
    userDetails = details
  }

  this.getUserDetails = function () {
    return userDetails
  }

  /**
    use realm.joinSession to connect to the realm
  */
  this.setRealm = function (realm) {
    this.realm = realm
  }

  this.addTrace = function (id, actor) {
    sTrace.set(id, actor)
  }

  this.getTrace = function (id) {
    return sTrace.get(id)
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
    for (let [key, /* subD */] of sTrace) {
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

  this.getSub = function (id) {
    return sSub.get(id)
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
    for (let [key, /* subD */] of sSub) {
      tmp.push(key)
      deletedCount++
    }
    for (let i = 0; i < tmp.length; i++) {
      this.removeSub(engine, tmp[i])
    }
    return deletedCount
  }

  this.handle = function (ctx, msg) {
    // console.log(this.sessionId, '>', msg)
    gate.handle(ctx, this, msg)
  }

  this.setDisconnectPublish = function (ctx, cmd) {
    willPublishCtx = ctx
    willPublishCmd = cmd
  }

  this.cleanDisconnectPublish = function () {
    willPublishCtx = undefined
    willPublishCmd = undefined
  }

  this.genSessionMsgId = function () {
    return ++sessionMsgId
  }

  this.waitForId = function (id, customId) {
    publishMap.set(customId, id)
  }

  this.fetchWaitId = function (customId) {
    let result = publishMap.get(customId)
    publishMap.delete(customId)
    return result
  }

  this.setLastPublishedId = function (id) {
    lastPublishedId = id
  }

  this.getLastPublishedId = function () {
    return lastPublishedId
  }

  this.cleanup = function () {
    if (this.realm && willPublishCmd && willPublishCtx) {
      this.realm.doPush(willPublishCtx, willPublishCmd)
    }
    gate.removeSession(this)
    if (this.realm) {
      this.realm.cleanupSession(this)
    }
    active = false
  }

  this.isActive = function () {
    return active
  }

  this.getGateProtocol = function () {
    return gate.getProtocol()
  }

  this.getRealmInfo = function () {
    if (this.realm) {
      return this.realm.getRealmInfo()
    } else {
      return {}
    }
  }

  this.getRealmName = function () {
    return this.realmName
  }
}

module.exports = Session
