'use strict'

const { keyId, MakeId } = require("../allot/makeid")

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

class EntrySession {
  constructor (wampSession, syncMass, history, gateId, pubResult) {
    this.wampSession = wampSession
    this.stackAdvanceSegment = []
    this.curAdvanceSegment = undefined
    this.syncMass = syncMass
    this.history = history
    this.gateId = gateId
    this.pubResult = pubResult
    this.segmentToWrite = new Map()
    this.isEventSource = false

    wampSession.subscribe('beginSegment', (args, kwargs, opts) => {
      console.log('beginSegment', kwargs)
      this.queueSync(kwargs.advanceSegment)
      wampSession.publish('beginSegmentAccepted', [], {advanceSegment: kwargs.advanceSegment})
    })

    wampSession.subscribe('storeHistory', (args, kwargs, opts) => {
      console.log("storeHistory", args, kwargs)
      this.delayEvent(kwargs)
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
      console.log('at '+this.gateId+': selected as event source', result)
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
    if (segment.count() !== event.advanceId.id) {
      console.error('serment position is not equal', segment.count(), event.advanceId.id)
    }
  }

  sendToMakeSegment (advanceSegment) {
    console.log('sendToMakeSegment on SYNC advanceSegment[', advanceSegment, "]")
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
    makeId.update(segmentId.dt + keyId(segmentId.id))

    for (let row of segment.content) {
      let id = makeId.makeIdStr()
      this.history.saveEventHistory(id, row.realm, row.uri, row.data, row.opt)
      result.push(id) // keep event position in result array
    }
    return result
  }
}

exports.EntrySession = EntrySession
