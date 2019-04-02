'use strict'

function mqttParse (topic) {
  return String(topic).split('/')
}

function wampParse (topic) {
  return String(topic).split('.')
}

function defaultParse (topic) {
  return String(topic).split('.')
}

function restoreUri (topic) {
  return topic.join('.')
}

function mqttMatch (topic, filter) {
  return match(mqttParse(topic), mqttParse(filter))
}

function wampMatch (topic, filter) {
  return match(wampParse(topic), wampParse(filter))
}

function match (topicArray, filterArray) {
  const length = filterArray.length

  for (var i = 0; i < length; ++i) {
    var left = filterArray[i]
    var right = topicArray[i]
    if (left === '#') return topicArray.length >= length - 1
    if (left !== '+' && left !== right) return false
  }
  return length === topicArray.length
}

function mqttExtract (topic, pattern) {
  if (topic === pattern) {
    return []
  } else if (pattern === '#') {
    return [topic]
  }

  var res = []

  var t = String(topic).split('/')
  var w = String(pattern).split('/')

  var i = 0
  for (var lt = t.length; i < lt; i++) {
    if (w[i] === '+') {
      res.push(t[i])
    } else if (w[i] === '#') {
      res.push(t.slice(i).join('/'))
      return res
    } else if (w[i] !== t[i]) {
      return null
    }
  }

  if (w[i] === '#') {
    i += 1
  }

  return (i === w.length) ? res : null
}

module.exports.mqttParse = mqttParse
module.exports.mqttMatch = mqttMatch
module.exports.restoreUri = restoreUri
module.exports.defaultParse = defaultParse

module.exports.wampParse = wampParse
module.exports.wampMatch = wampMatch

module.exports.match = match
module.exports.mqttExtract = mqttExtract
