'use strict'

const { BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } = require('../realm')
const { ReactEngine, ReactBinder } = require('../binder')

const NET_REALM_NAME = 'sys'

class HistorySegment {
  constructor (segmentId) {
    this.content = []
    this.segmentId = segmentId
  }

  addActor (actor) {
    this.content.push(actor)
    return this.segmentId
  }
}

class NetBinder extends ReactBinder {
  constructor (router) {
    super()
    this.curSegment = null
    this.segmentId = 0
    this.segments = new Map()

    const realm = new BaseRealm(router, new BaseEngine())
    router.addRealm(NET_REALM_NAME, realm)
    this.api = realm.foxApi()

    this.api.subscribe(['readyId'], (data, opt) => {
      console.log('READY-ID', data, opt)
    })
  }

  getSegment () {
    if (this.curSegment) {
      return this.curSegment
    }
    this.segmentId++
    this.curSegment = new HistorySegment(this.segmentId)
    this.segments.set(this.segmentId, this.curSegment)
    return this.curSegment
  }

  keepHistory (engine, actor) {
    let segment = this.getSegment()
    let id = segment.addActor(actor)

    this.api.publish(['mqlog'], {kv:{
      segmengId: id,
      realm: engine.getRealmName(),
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt()
    }})
  }

  segmentSaved() {
    // actor.destSID = engine.dispatch(actor.getEvent())
    // actor.confirm(actor.msg)
  }

  getHistoryAfter (engine, after, uri, cbRow) {
    return this.msg.getEventHistory(
      engine.getRealmName(),
      { fromId: after, uri },
      (event) => {
        cbRow({
          qid: event.id,
          uri: event.uri,
          data: unSerializeData(event.body)
        })
      }
    )
  }

  cleanupSession(engine, sessionId) {
    return Promise.resolve(true)
  }
}

exports.NetBinder = NetBinder
exports.NetEngine = ReactEngine
