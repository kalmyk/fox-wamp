const crypto = require('crypto')

function randomId () {
  return crypto.randomBytes(6).readUIntBE(0, 6)
}

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
  return String.fromCharCode(idStr.length + 96) +
         idStr
}

module.exports.randomId = randomId
module.exports.keyDate = keyDate
module.exports.keyId = keyId
