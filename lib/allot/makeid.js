'use strict'

function keyDate (date) {
  const month = date.getUTCMonth() + 1
  const day = date.getUTCDate()
  const hour = date.getUTCHours()
  const minutes = date.getUTCMinutes()

  return date.getUTCFullYear().toString().substr(-2) +
    (month < 10 ? '0' + month : month) +
    (day < 10 ? '0' + day : day) +
    (hour < 10 ? '0' + hour : hour) +
    (minutes < 10 ? '0' + minutes : minutes)
}

function keyId (id) {
  const idStr = id.toString(36)
  return String.fromCharCode(idStr.length + 96) + idStr
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
    dt: keyDate(date),
    id: 0
  }
}

class MakeId {
  constructor (getPrefix) {
    this.prefix = ''
    this.generator = 0
    this.getPrefix = getPrefix
  }

  reconcilePos (newPrefix, newPosition) {
    if (newPrefix > this.prefix) {
      this.prefix = newPrefix
      this.generator = newPosition ? newPosition : 0
      return true
    }
    if (newPrefix === this.prefix) {
      this.generator = newPosition ? Math.max(this.generator, newPosition) : this.generator
      return true
    }
    return false
  }

  update (v) {
    return this.reconcilePos(this.getPrefix(v))
  }

  makeIdRec (step) {
    this.generator += step ? step : 1
    return {
      dt: this.prefix,
      id: this.generator
    }
  }

  makeIdStr (step) {
    const newId = this.makeIdRec(step)
    return newId.dt + keyId(newId.id)
  }
}

exports.keyDate = keyDate
exports.keyId = keyId
exports.mergeMax = mergeMax
exports.mergeMin = mergeMin
exports.makeEmpty = makeEmpty
exports.MakeId = MakeId
