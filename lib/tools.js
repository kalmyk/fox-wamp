'use strict'

const crypto = require('crypto')

function randomId () {
  return crypto.randomBytes(6).readUIntBE(0, 6)
}

module.exports.randomId = randomId
