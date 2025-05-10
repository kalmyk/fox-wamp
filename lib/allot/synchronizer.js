'use strict'

const MSG = require('../messages')
const {mergeMin, keyDate, ProduceId} = require('./makeid')
const {QuorumEdge} = require('./quorum_edge')

class InitSeed {
  constructor(sysRealm) {
    this.realm = sysRealm
    this.advanceSegmentCollector = new Map()
    this.makeId = new ProduceId(date => keyDate(date))

    // build api before new session handler to not to be caught
    this.api = sysRealm.buildApi()

    sysRealm.on(MSG.SESSION_JOIN, (session) => {
      this.syncQuorum.addMember(session.getSid())
    })
    
    sysRealm.on(MSG.SESSION_LEAVE, (session) => {
      this.syncQuorum.delMember(session.getSid())
    })

    this.syncQuorum = new QuorumEdge((advanceSegment, value) => {
      console.log('QSYNC!', advanceSegment, '=>', value)
      this.api.publish('commitSegment', null, {headers: {advanceSegment, readyId: value}})
    }, mergeMin)
        
    this.api.subscribe('makeSegmentId', (body, opt) => {
      console.log('=> receive MAKE-ID', body, opt.headers)
      this.makeQuorum.vote(opt.sid, opt.headers.advanceSegment, opt.headers.step)
    })    
    this.api.subscribe('syncId', (body, opt) => {
      console.log('SYNC-ID', body, opt)
      this.makeId.reconcilePos(opt.headers.maxId.dt, opt.headers.maxId.id)
      this.syncQuorum.vote(opt.sid, opt.headers.advanceSegment, opt.headers.syncId)
    })
    this.api.subscribe('generateSegment', this.event_generateSegment.bind(this))
    this.api.subscribe('draftSegment', this.event_draftSegment.bind(this))
  }

  // generate new segment id for each advanceId
  // if advanceId is duplicated new segment is not generated
  // input headers: advanceOwner, advanceSegment
  event_generateSegment (body, opt) {
    const advanceOwner = opt.headers.advanceOwner
    const advanceSegment = opt.headers.advanceSegment
    const advanceId = advanceOwner+':'+advanceSegment
    if (!this.advanceSegmentCollector.has(advanceId)) {
      const draftId = this.makeId.generateIdRec()
      this.advanceSegmentCollector.set(advanceId, {draftId, advanceOwner, advanceSegment, sid: opt.headers.publisher})
      this.api.publish('draftSegment', null, {headers: {advanceOwner, advanceSegment, draftOwner: this.realm.getRouter().getId(), draftId}})
    }
  }

  // when another generator made draft shift my generator
  event_draftSegment (body, opt) {
    const changed = this.makeId.reconcilePos(opt.headers.draftId.dt, opt.headers.draftId.id)
    // todo register in advanceSegmentCollector
  }

  reconcilePos (segment, offset) {
    return this.makeId.reconcilePos(segment, offset)
  }

  startActualizePrefixTimer () {
    this.makeId.actualizePrefix()
    setInterval(() => {
      this.makeId.actualizePrefix()
    }, 7000)
  }
}

class StageOne {
  constructor (sysRealm, majorLimit) {
    this.majorLimit = majorLimit
    this.api = sysRealm.buildApi()
    this.recentValue = ''
    this.advanceIdHeap = new Map()
    this.doneHeap = new Map()
    this.draftHeap = new Set()  // todo by draft owner

    this.api.subscribe('draftSegment', this.event_draftSegment.bind(this))
  }

  getRecentValue () {
    return this.recentValue
  }

  setRecentValue (newRecentValue) {
    if (this.recentValue > newRecentValue) {
      throw Error('failed to set recentValue: "'+this.recentValue+'">"'+newRecentValue+'"')
    }
    this.recentValue = newRecentValue
  }

  // todo: take maximum of two drafts, provode minimal on wait to stream events
  event_draftSegment(body, opt) {
    const draftOwner = opt.headers.draftOwner
    const advanceOwner = opt.headers.advanceOwner
    const advanceSegment = opt.headers.advanceSegment
    const advanceId = advanceOwner+':'+advanceSegment
    const draftId = opt.headers.draftId.dt + opt.headers.draftId.id

    this.draftHeap.add(draftId)

    if (this.doneHeap.has(advanceId)) {
      const vouterSet = this.doneHeap.get(advanceId)
      vouterSet.add(draftOwner)
      while (this.draftHeap.size > this.advanceIdHeap.size) {
        this.extractDraft()
      }
      return
    } 
    
    if (!this.advanceIdHeap.has(advanceId)) {
      this.advanceIdHeap.set(advanceId, new Set())
    }
    const vouterSet = this.advanceIdHeap.get(advanceId)
    vouterSet.add(draftOwner)

    while (this.draftHeap.size > this.advanceIdHeap.size) {
      this.extractDraft()
    }

    if (vouterSet.size >= this.majorLimit) {
      this.advanceIdHeap.delete(advanceId)
      this.doneHeap.set(advanceId, vouterSet)
      const challenger = this.extractDraft()
      this.api.publish('challengerExtract', null, {headers: {challenger, advanceOwner, advanceSegment}})
    }
  }

  // extract minimal from draftHeap and save it to recentValue
  extractDraft() {
    let minValue
    for (const cur of this.draftHeap.values()) {
      minValue = ( minValue && minValue < cur ) ? minValue : cur
    }
    this.draftHeap.delete(minValue)
    this.recentValue = minValue
    return minValue
  }
}

exports.InitSeed = InitSeed
exports.StageOne = StageOne
