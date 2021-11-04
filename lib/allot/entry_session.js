'use strict'

const { keyId } = require("../tools")

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
  constructor (wampSession, syncMass, gateMass, history, gateId) {
    this.wampSession = wampSession
    this.stackAdvanceSegment = []
    this.curAdvanceSegment = undefined
    this.syncMass = syncMass
    this.gateMass = gateMass
    this.history = history
    this.gateId = gateId
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

    wampSession.subscribe('eventSource', (args, kwargs, opts) => {
      if (kwargs.pid == process.pid) {
        console.log('at '+this.gateId + ": eventSource is here, "+this.isEventSource, args, kwargs, opts)
      }
    }, {retained: true})

    wampSession.publish(
      'eventSource',
      [],
      { pid: process.pid },
      { acknowledge: true, retain: true, when: null, will: null, watch: true, exclude_me: false }
    ).then((result) => {
      console.log('at '+this.gateId+': selected as event source', result)
      this.isEventSource = true
    })
  }

  mkDbId (segmentId, offset) {
    return segmentId.dt+keyId(segmentId.id)+keyId(offset)
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

  sendToSync (advanceSegment) {
    console.log('sendToSync advanceSegment[', advanceSegment, "]")
    for (let [,ss] of this.syncMass) {
      ss.publish('makeSegmentId', [], {advanceSegment})
    }
  }

  checkLine () {
    if (this.curAdvanceSegment) {
      return false
    }
    this.curAdvanceSegment = this.stackAdvanceSegment.shift()
    if (this.curAdvanceSegment) {
      this.sendToSync(this.curAdvanceSegment)
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
        console.log('publishSegment', event)
        this.wampSession.publish('dispatch', [], {
          route: event.route,
          realm: event.realm,
          data: event.data,
          uri: event.uri,
          opt: event.opt
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
        this.wampSession.publish('ackSegment', [], {advanceSegment, segmentId, effectId})
        for (const gg of this.gateMass.values()) {
          gg.publishSegment(segment)
        }
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
    let offset = 1
    for (let row of segment.content) {
      let id = this.mkDbId(segmentId, offset)
      if (row.route == 'in') {
        this.history.saveEventHistory(id, undefined, row.realm, row.uri, row.data)
      } else if (row.route == 'out') {
        this.history.saveUpdateHistory(id, undefined, row.realm, row.uri, row.data)
      } else {
        console.error("unknown route ", row)
      }
      offset++
      result.push(id) // keep event position in result array
    }
    return result
  }
}

exports.EntrySession = EntrySession
