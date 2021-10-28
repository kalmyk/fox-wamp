'use strict'

const { BaseRealm, BaseEngine, makeDataSerializable, unSerializeData } = require('../realm')
const { ReactEngine, ReactBinder } = require('../binder')

const NET_REALM_NAME = 'sys'

class HistorySegment {
  constructor (applicantId) {
    this.content = []
    this.applicantId = applicantId
  }

  addActor (actor) {
    this.content.push(actor)
    return this.applicantId
  }

  getApplicantId () {
    return this.applicantId
  }
}

class NetBinder extends ReactBinder {
  constructor (router) {
    super()
    this.curSegment = null
    this.applicantGen = 0
    this.segments = new Map()
    this.router = router

    const realm = new BaseRealm(router, new BaseEngine())
    router.addRealm(NET_REALM_NAME, realm)
    this.api = realm.foxApi()

    this.api.subscribe(['pong'], (data, opt) => {
      this.curSegment = null
      console.log('PONG', data, opt)
    })

    this.api.subscribe(['readyId'], (data, opt) => {
      this.segmentCommited(data.kwargs, opt)
    })

    this.api.subscribe(['dispatch'], (data, opt) => {
      console.log('DISPATCH', data, opt)
    })
  }

  getSegment () {
    if (this.curSegment) {
      return this.curSegment
    }
    this.applicantGen++
    let curApplicantId = '' + this.router.getId() + '-' + this.applicantGen
    this.curSegment = new HistorySegment(curApplicantId)
    this.segments.set(curApplicantId, this.curSegment)
    this.api.publish(['mkSegmentId'], {kv:{
      applicantId: curApplicantId
    }})
    this.api.publish(['db-ping'], {kv:{
      applicantId: curApplicantId
    }})
    return this.curSegment
  }

  findSegment(applicantId) {
    return this.segments.get(applicantId)
  }

  segmentCommited (applicant, opt) {
    console.log('segmentCommited', applicant, opt)
    let segment = this.findSegment(applicant.applicantId)
    if (!segment) {
      return
    }
    for (let actor of segment.content) {
      actor.confirm()
    }
    // segmentCommited { applicantId: 181, segmentId: { dt: '2104230438', id: 18 } }
    // segmentCommited { applicantId: 181, segmentId: { dt: '2104230438', id: 18 } }
    // segmentCommited { applicantId: 182, segmentId: { dt: '2104230438', id: 19 } }
    // segmentCommited { applicantId: 182, segmentId: { dt: '2104230438', id: 19 } }
  }

  storeInHistory (engine, actor) {
    let segment = this.getSegment()
    let id = segment.addActor(actor)

    this.api.publish(['storeInHistory'], {kv:{
      applicantId: id,
      realm: engine.getRealmName(),
      data: makeDataSerializable(actor.getData()),
      uri: actor.getUri(),
      opt: actor.getOpt()
    }})
    return Promise.resolve(true)
  }

  storeOutHistory (engine, actor) {
    let segment = this.getSegment()
    let id = segment.addActor(actor)

    this.api.publish(['storeOutHistory'], {kv:{
      applicantId: id,
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
