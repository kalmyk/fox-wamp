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
    return { segment: this.advanceSegment, offset: this.generator }
  }

  fetchActor (advanceId) {
    if (advanceId.segment !== this.advanceSegment) {
      throw Error("advance is not identical "+advance.segment+" "+this.advanceSegment)
    }
    let actor = this.content.get(advanceId.offset)
    if (actor) {
      this.content.delete(advanceId.offset)
    }
    return actor
  }

  getAdvanceSegment() {
    return this.advanceSegment
  }
}

class NetEngine extends PromiseEngine {
  doPush (actor) {
    this.saveInboundHistory(actor)
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
    this.sysApi = this.sysRealm.api()

    this.sysApi.subscribe('fillup-advance-segment', (data, opt) => {
      // to do voute for complete
      if (!data.advanceSegment) {
        console.error('ERROR: no advanceSegment in package')
      }
      if (this.curSegment) {
        if (data.advanceSegment == this.curSegment.getAdvanceSegment()) {
          // it will be required to create new segment at the next inbound message
          this.curSegment = null
          console.log('advance-segment-over =>', data.advanceSegment)
          this.sysApi.publish('advance-segment-over', {
            advanceSegment: data.advanceSegment
          })
        } else {
          console.warn('warn: new segment is not accepted, cur:', this.curSegment.getAdvanceSegment(), 'inbound:', data.advanceSegment)
        }
      }
    })

    this.sysApi.subscribe('advance-segment-resolved', (data, opt) => {
      this.advanceSegmentResolved(opt.headers)
    })

    this.sysApi.subscribe('dispatchEvent', (data, opt) => {
      console.log('=> dispatchEvent', opt.headers.qid)
      this.dispatchEvent(opt.headers)
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
    this.sysApi.publish('begin-advance-segment', {
      advanceSegment: curAdvanceSegment
    })
    return this.curSegment
  }

  findSegment (advanceSegment) {
    return this.segments.get(advanceSegment)
  }

  deleteSegment (advanceSegment) {
    return this.segments.delete(advanceSegment)
  }

  advanceSegmentResolved (syncMessage) {
    let segment = this.findSegment(syncMessage.advanceSegment)
    if (!segment) {
      return
    }
    console.log('advance-segment-resolved', syncMessage.advanceSegment, syncMessage.pkg)
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

  saveHistory (engine, actor) {
    let segment = this.getSegment()
    let advanceId = segment.addActor(actor)

    return this.sysApi.publish('keep-advance-history', null, { headers:{
      advanceId: advanceId,
      realm: engine.getRealmName(),
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt(),
      sid: actor.getSid()
    }})
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

  dispatchEvent (eventData) {
    const realm = this.router.findRealm(eventData.realm)
    if (realm) {
      realm.getEngine().disperseToSubs({
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
