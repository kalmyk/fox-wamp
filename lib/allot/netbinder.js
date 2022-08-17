'use strict'

const { BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } = require('../realm')
const { PromiseEngine, PromiseBinder } = require('../binder')
const { MemKeyValueStorage } = require('../mono/memkv')

const INTRA_REALM_NAME = 'sys'

class HistorySegment {
  constructor (advanceSegment) {
    this.content = new Map()
    this.advanceSegment = advanceSegment
    this.generator = 0
  }

  addActor (actor) {
    this.generator++
    this.content.set(this.generator, actor)
    return { segment: this.advanceSegment, id: this.generator }
  }

  fetchActor (advance) {
    if (advance.segment !== this.advanceSegment) {
      throw "advance is not identical "+advance.segment+" "+this.advanceSegment
    }
    let actor = this.content.get(advance.id)
    if (actor) {
      this.content.delete(advance.id)
    }
    return actor
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
    router.addRealm(INTRA_REALM_NAME, this.sysRealm)
    this.sysRealm.registerKeyValueEngine(['#'], new MemKeyValueStorage())
    this.api = this.sysRealm.foxApi()

    this.api.subscribe(['beginSegmentAccepted'], (data, opt) => {
      // it is time to create new segment if it is necessary
      this.curSegment = null
    })

    this.api.subscribe(['ackSegment'], (data, opt) => {
      this.ackSegment(data.kwargs)
    })

    this.api.subscribe(['dispatchEvent'], (data, opt) => {
      this.dispatchEvent(data.kwargs, opt)
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

  findSegment (advanceSegment) {
    return this.segments.get(advanceSegment)
  }

  deleteSegment (advanceSegment) {
    return this.segments.delete(advanceSegment)
  }

  ackSegment (syncMessage) {
    let segment = this.findSegment(syncMessage.advanceSegment)
    if (!segment) {
      return
    }
    console.log('ackSegment', syncMessage.advanceSegment)
    for (let event of syncMessage.pkg) {
      let actor = segment.fetchActor(event.advanceId)
      if (actor) {
        actor.setEventId(event.qid)
        actor.confirm()
      } else {
        console.log("actor not found by advanceId", event.advanceId)
      }
    }
    if (syncMessage.final) {
      this.deleteSegment(syncMessage.advanceSegment)
      if (segment.size() > 0) {
        console.log("removing not empty segment")
      }
    }
  }

  storeHistory (engine, actor) {
    let segment = this.getSegment()
    let advanceId = segment.addActor(actor)

    this.api.publish(['storeHistory'], {kv:{
      advanceId: advanceId,
      realm: engine.getRealmName(),
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt(),
      sid: actor.getSid()
    }})
  }

  storeInHistory (engine, actor) {
    return this.storeHistory(engine, actor)
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

  dispatchEvent (eventData, opt) {
    const realm = this.router.findRealm(eventData.realm)
    if (realm) {
      console.log('dispatchEvent', eventData.realm, eventData, opt)
      realm.getEngine().dispatch({
        qid: eventData.qid,
        uri: eventData.uri,
        data: unSerializeData(eventData.data),
        opt: eventData.opt,
        sid: eventData.sid
      })
    }
  }

  cleanupSession (engine, sessionId) {
    return Promise.resolve(true)
  }
}

exports.NetBinder = NetBinder
exports.NetEngine = NetEngine
