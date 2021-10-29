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
  constructor (wampSession, syncMass, history) {
    this.wampSession = wampSession
    this.stackAdvanceSegment = []
    this.curAdvanceSegment = undefined
    this.syncMass = syncMass
    this.history = history
    this.segmentToWrite = new Map()

    wampSession.subscribe('mkSegmentId', (args, kwargs, opts) => {
      console.log('mkSegmentId', kwargs)
      this.queueSync(kwargs.applicantId)
    })

    wampSession.subscribe('db-ping', (args, kwargs, opts) => {
      console.log('db-ping', kwargs)
      wampSession.publish('pong', args, kwargs)
    })

    wampSession.subscribe('storeHistory', (args, kwargs, opts) => {
      console.log("event-storeHistory", args, kwargs);
      this.delayEvent(kwargs)
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
      ss.publish('syncSegmentId', [], {advanceSegment})
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

  commitSegment (advanceSegment, segmentId) {
    // check is AdvanceSegment of mine session
    if (this.curAdvanceSegment === advanceSegment) {
      this.dbSaveSegment(advanceSegment, segmentId)
      this.wampSession.publish('ackSegment', [], {advanceSegment, segmentId})
      this.curAdvanceSegment = undefined
      return this.checkLine()
    }
    return false
  }

  dbSaveSegment (advanceSegment, segmentId) {
    console.log("dbSaveSegment", advanceSegment, segmentId)
    let segment = this.segmentToWrite.get(advanceSegment)
    if (!segment) {
      console.error("advanceSegment not found in segments [", advanceSegment, "]")
      return
    }
    let offset = 1
    for (let row of segment.content) {
      if (row.route == 'in') {
        this.history.saveEventHistory(this.mkDbId(segmentId, offset), undefined, row.realm, row.uri, row.data)
      } else if (row.route == 'out') {
        this.history.saveUpdateHistory(this.mkDbId(segmentId, offset), undefined, row.realm, row.uri, row.data)
      } else {
        console.error("unknown route ", row)
      }
      offset++
    }
    this.segmentToWrite.delete(advanceSegment)
  }
}

exports.EntrySession = EntrySession
