'use strict'

const { EventEmitter } = require('events')
const { keyId, MakeId } = require("./makeid")

class HistorySegment {
  constructor () {
    this.content = []
  }

  addEvent (event) {
    this.content.push(event)
  }

  count () {
    return this.content.length
  }
}

class SessionEntryHistory extends EventEmitter {
  constructor (wampSession, syncMass, historyDb, gateId, pubResult) {
    super()
    this.wampSession = wampSession
    this.stackAdvanceSegment = []
    this.curAdvanceSegment = undefined
    this.syncMass = syncMass
    this.historyDb = historyDb
    this.gateId = gateId
    this.pubResult = pubResult
    this.segmentToWrite = new Map()
    this.isEventSource = false

    wampSession.subscribe('begin-advance-segment', (args, kwargs, opts) => {
      const advanceSegment = args[0].advanceSegment
      wampSession.publish('fillup-advance-segment', [{advanceSegment: advanceSegment}])
    })

    wampSession.subscribe('keep-advance-history', (args, kwargs, opts) => {
      console.log("keep-advance-history", args, kwargs)
      this.delayEvent(kwargs)
    })

    wampSession.subscribe('advance-segment-over', (args, kwargs, opts) => {
      const advanceSegment = args[0].advanceSegment
      this.queueSync(advanceSegment)
    })

    wampSession.subscribe('eventSourceLock', (args, kwargs, opts) => {
      if (kwargs.pid == process.pid) {
        console.log('gate '+this.gateId + ": eventSource in "+this.isEventSource, args, kwargs, opts)
      }
    }, {retained: true})

    wampSession.publish(
      'eventSourceLock',
      [],
      { pid: process.pid },
      { acknowledge: true, retain: true, when: null, will: null, watch: true, exclude_me: false }
    ).then((result) => {
      console.log('GATE:'+this.gateId+': use that db as event source', result)
      this.isEventSource = true
    })
  }

  delayEvent (event) {
    let segment = this.segmentToWrite.get(event.advanceId.segment)
    if (!segment) {
      segment = new HistorySegment()
      this.segmentToWrite.set(event.advanceId.segment, segment)
    }
    segment.addEvent(event)
    if (segment.count() !== event.advanceId.offset) {
      console.error('serment position is not equal', segment.count(), event.advanceId.offset)
    }
  }

  sendToMakeSegment (advanceSegment) {
    console.log('sendToMakeSegment on SYNC advanceSegment[', advanceSegment, '] to count:', this.syncMass.size)
    for (let [,ss] of this.syncMass) {
      ss.publish('makeSegmentId', [], {advanceSegment, step: 2})
    }
  }

  checkLine () {
    if (this.curAdvanceSegment) {
      return false
    }
    this.curAdvanceSegment = this.stackAdvanceSegment.shift()
    if (this.curAdvanceSegment) {
      this.sendToMakeSegment(this.curAdvanceSegment)
      return true
    }
    return false
  }

  queueSync (advanceSegment) {
    this.stackAdvanceSegment.push(advanceSegment)
    return this.checkLine()
  }

  publishSegment (segment) {
    if (this.isEventSource) {
      for (const event of segment.content) {
        console.log('publishSegment-dispatchEvent', event)
        this.wampSession.publish('dispatchEvent', [], {
          realm: event.realm,
          data: event.data,
          uri: event.uri,
          opt: event.opt,
          sid: event.sid,
          qid: event.qid
        })
      }
    }
  }

  commitSegment (advanceSegment, segmentId) {
    // check is advanceSegment of mine session
    if (this.curAdvanceSegment === advanceSegment) {
      console.log("dbSaveSegment", advanceSegment, segmentId)
      let segment = this.segmentToWrite.get(advanceSegment)
      if (segment) {
        this.segmentToWrite.delete(advanceSegment)
        let effectId = this.dbSaveSegment(segment, segmentId)
        this.pubResult(advanceSegment, segment, effectId)
      } else {
        console.error("advanceSegment not found in segments [", advanceSegment, "]")
      }
      this.curAdvanceSegment = undefined
      return this.checkLine()
    }
    return false
  }

  // todo: wait for promise in saveEventHistory
  dbSaveSegment (segment, segmentId) {
    let result = []
    const makeId = new MakeId((a) => a)
    makeId.actualizePrefix(segmentId.dt + keyId(segmentId.id))

    for (let row of segment.content) {
      let id = makeId.makeIdStr()
      this.historyDb.saveEventHistory(id, row.realm, row.uri, row.data, row.opt)
      result.push(id) // keep event position in result array
    }
    return result
  }
}

exports.SessionEntryHistory = SessionEntryHistory
