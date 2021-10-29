'use strict'

const { BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } = require('../realm')
const { ReactEngine, ReactBinder } = require('../binder')

const NET_REALM_NAME = 'sys'

class HistorySegment {
  constructor (advanceSegment) {
    this.content = []
    this.advanceSegment = advanceSegment
  }

  addActor (actor) {
    this.content.push(actor)
    return { segment: this.advanceSegment, id: this.content.length }
  }
}

class NetBinder extends ReactBinder {
  constructor (router) {
    super()
    this.curSegment = null
    this.advanceSegmentGen = 0
    this.segments = new Map()
    this.router = router

    const realm = new BaseRealm(router, new BaseEngine())
    router.addRealm(NET_REALM_NAME, realm)
    this.api = realm.foxApi()

    this.api.subscribe(['pong'], (data, opt) => {
      this.curSegment = null
      console.log('PONG', data, opt)
    })

    this.api.subscribe(['ackSegment'], (data, opt) => {
      this.ackSegment(data.kwargs, opt)
    })

    this.api.subscribe(['dispatch'], (data, opt) => {
      console.log('DISPATCH', data, opt)
    })
  }

  getSegment () {
    if (this.curSegment) {
      return this.curSegment
    }
    this.advanceSegmentGen++
    let curAdvanceSegment = '' + this.router.getId() + '-' + this.advanceSegmentGen
    this.curSegment = new HistorySegment(curAdvanceSegment)
    this.segments.set(curAdvanceSegment, this.curSegment)
    this.api.publish(['mkSegmentId'], {kv:{
      applicantId: curAdvanceSegment
    }})
    this.api.publish(['db-ping'], {kv:{
      applicantId: curAdvanceSegment
    }})
    return this.curSegment
  }

  findSegment(advanceSegment) {
    return this.segments.get(advanceSegment)
  }

  deleteSegment(advanceSegment) {
    return this.segments.delete(advanceSegment)
  }

  ackSegment (syncMessage, opt) {
    let segment = this.findSegment(syncMessage.advanceSegment)
    if (!segment) {
      return
    }
    console.log('ackSegment', syncMessage, opt)
    for (let actor of segment.content) {
      // actor.setEventId(1234)
      actor.confirm()
    }
    this.deleteSegment(syncMessage.advanceSegment)
  }

  storeHistory (route, engine, actor) {
    let segment = this.getSegment()
    let advanceId = segment.addActor(actor)

    this.api.publish(['storeHistory'], {kv:{
      advanceId: advanceId,
      route: route,
      realm: engine.getRealmName(),
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt()
    }})
    return Promise.resolve(true)
  }

  storeInHistory (engine, actor) {
    return this.storeHistory('in', engine, actor)
  }

  storeOutHistory (engine, actor) {
    return this.storeHistory('out', engine, actor)
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
