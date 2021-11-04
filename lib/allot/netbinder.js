'use strict'

const { BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } = require('../realm')
const { PromiseEngine, PromiseBinder } = require('../binder')
const { MemKeyValueStorage } = require('../mono/memkv')

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

class NetEngine extends PromiseEngine {
  doPush (actor) {
    this.storeInHistory(actor)
  }
}

class NetBinder extends PromiseBinder {
  constructor (router) {
    super()
    this.curSegment = null
    this.advanceSegmentGen = 0
    this.segments = new Map()
    this.router = router

    this.sysRealm = new BaseRealm(router, new BaseEngine())
    router.addRealm(NET_REALM_NAME, this.sysRealm)
    this.sysRealm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
    this.api = this.sysRealm.foxApi()

    this.api.subscribe(['beginSegmentAccepted'], (data, opt) => {
      // it is time to create new segment if it is necessary
      this.curSegment = null
    })

    this.api.subscribe(['ackSegment'], (data, opt) => {
      this.ackSegment(data.kwargs, opt)
    })

    this.api.subscribe(['dispatch'], (data, opt) => {
      this.dispathEvent(data.kwargs, opt)
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
    this.api.publish(['beginSegment'], {kv:{
      advanceSegment: curAdvanceSegment
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
    for (let i = 0; i < segment.content.length; i++) {
      let actor = segment.content[i]
      let id = syncMessage.effectId[i]
      actor.setEventId(id)
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

  dispathEvent (eventData, opt) {
    const realm = this.router.findRealm(eventData.realm)
    if (realm) {
      console.log('DISPATCH', eventData.realm, eventData, opt)
      realm.getEngine().dispatch({
        uri: eventData.uri,
        data: eventData.data,
        opt: eventData.opt
      })
    }
  }

  cleanupSession (engine, sessionId) {
    return Promise.resolve(true)
  }
}

exports.NetBinder = NetBinder
exports.NetEngine = NetEngine
