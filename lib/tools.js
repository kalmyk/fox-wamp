module.exports.randomId = function () {
  return require('crypto').randomBytes(6).readUIntBE(0, 6)
}
