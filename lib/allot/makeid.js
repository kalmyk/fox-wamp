'use strict'

function formatDate (date) {
  let month = date.getUTCMonth() + 1
  month = month < 10 ? '0' + month : month

  let day = date.getUTCDate()
  day = day < 10 ? '0' + day : day

  let hour = date.getUTCHours()
  hour = hour < 10 ? '0' + hour : hour
    
  let minutes = date.getUTCMinutes()
  minutes = minutes < 10 ? '0' + minutes : minutes
  
  return date.getUTCFullYear().toString().substr(-2) + month + day + hour + minutes
}

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
    dt: formatDate(date),
    id: 0
  }
}

class MakeId {
  constructor () {
    this.dateStr = ''
    this.generator = 0
  }

  update (date) {
    let newDate = formatDate(date)
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

  shift(challengerId) {
    if (challengerId.dt > this.dateStr) {
      this.generator = challengerId.id
      this.dateStr = challengerId.dt
    } else if (challengerId.dt == this.dateStr && challengerId.id > this.generator) {
      this.generator = challengerId.id
    }
  }
}

exports.formatDate = formatDate
exports.mergeMax = mergeMax
exports.mergeMin = mergeMin
exports.makeEmpty = makeEmpty
exports.MakeId = MakeId
