'use strict'

const { keyId } = require("../tools")

class HistorySegment {
  constructor () {
    this.content = []
  }

  addEvent (event) {
    this.content.push(event)
  }
}

class EntrySession {
  constructor (wampSession, syncMass, history) {
    this.wampSession = wampSession
    this.stackApplicantId = []
    this.curApplicantId = undefined
    this.syncMass = syncMass
    this.history = history
    this.segmentToWrite = new Map()

    wampSession.subscribe('mkId', (publishArgs, kwargs, opts) => {
      console.log('mkId', kwargs)
      this.queueSync(kwargs.applicantId)
    })

    wampSession.subscribe('ping', (publishArgs, kwargs, opts) => {
      console.log('ping', kwargs)
      wampSession.publish('pong', publishArgs, kwargs)
    })

    wampSession.subscribe('mqlog', (publishArgs, kwargs, opts) => {
      this.delayEvent(kwargs)
    })
  }

  mkDbId (segmentId, offset) {
    return segmentId.dt+keyId(segmentId.id)+keyId(offset)
  }

  delayEvent (event) {
    let segment = this.segmentToWrite.get(event.applicantId)
    if (!segment) {
      console.error("applicantId not found to delay [", event.applicantId, "]", event)
      segment = new HistorySegment()
      this.segmentToWrite.set(event.applicantId, segment)
    }
    segment.addEvent(event)
  }

  sendToSync (applicantId) {
    console.log('sendToSync applicantId[', applicantId, "]")
    for (let [,ss] of this.syncMass) {
      ss.publish('mkId', [], {applicantId})
    }
    if (!this.segmentToWrite.has(applicantId)) {
      this.segmentToWrite.set(applicantId, new HistorySegment())
    }
  }

  checkLine() {
    if (this.curApplicantId) {
      return false
    }
    this.curApplicantId = this.stackApplicantId.shift()
    if (this.curApplicantId) {
      this.sendToSync(this.curApplicantId)
      return true
    }
    return false
  }

  queueSync (applicantId) {
    this.stackApplicantId.push(applicantId)
    return this.checkLine()
  }

  commitSegment (applicantId, segmentId) {
    // check is applicant of mine session
    if (this.curApplicantId === applicantId) {
      this.dbSaveSegment(applicantId, segmentId)
      this.wampSession.publish('readyId', [], {applicantId, segmentId})
      this.curApplicantId = undefined
      return this.checkLine()
    }
    return false
  }

  dbSaveSegment (applicantId, segmentId) {
    console.log("dbSaveSegment", applicantId, segmentId)
    let segment = this.segmentToWrite.get(applicantId)
    if (!segment) {
      console.error("applicantId not found in segments [", applicantId, "]")
      return
    }
    let offset = 1
    for (let row of segment.content) {
      this.history.saveEventHistory(this.mkDbId(segmentId, offset), undefined, row.realm, row.uri, row.data)
      offset++
    }
  }
}

exports.EntrySession = EntrySession
