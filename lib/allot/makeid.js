'use strict'

const { keyDate } = require('../tools')

function mergeMax(a, b) {
  if (a.dt > b.dt) {
    return a
  } else if (a.dt < b.dt) {
    return b
  } else {
    return {dt: a.dt, id: Math.max(a.id, b.id)}
  }
}

function mergeMin(a, b) {
  if (a.dt > b.dt) {
    return b
  } else if (a.dt < b.dt) {
    return a
  } else {
    return {dt: a.dt, id: Math.min(a.id, b.id)}
  }
}

function makeEmpty(date) {
  return {
    dt: keyDate(date),
    id: 0
  }
}

class MakeId {
  constructor () {
    this.dateStr = ''
    this.generator = 0
  }

  update (date) {
    let newDate = keyDate(date)
    if (newDate > this.dateStr) {
      this.generator = 0
      this.dateStr = newDate
    }
  }

  makeId () {
    this.generator++
    return {
      // format: this.format,
      dt: this.dateStr,
      id: this.generator
    }
  }

  reconcile(challengerId) {
    if (challengerId.dt > this.dateStr) {
      this.generator = challengerId.id
      this.dateStr = challengerId.dt
    } else if (challengerId.dt == this.dateStr && challengerId.id > this.generator) {
      this.generator = challengerId.id
    }
  }
}

exports.mergeMax = mergeMax
exports.mergeMin = mergeMin
exports.makeEmpty = makeEmpty
exports.MakeId = MakeId
