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

// match topic to pattern
function match (topicArray, patternArray) {
  const length = patternArray.length

  for (var i = 0; i < length; ++i) {
    let pattern = patternArray[i]
    let topic = topicArray[i]
    if (pattern === '#') return topicArray.length >= length - 1
    if (pattern !== '+' && pattern !== topic) return false
  }
  return length === topicArray.length
}

// pattern fits shape
function intersect (patternArray, shapeArray) {
  const length = Math.min(patternArray.length, shapeArray.length)

  for (var i = 0; i < length; ++i) {
    let shape = shapeArray[i]
    let pattern = patternArray[i]
    if (shape === '#' || pattern === '#') return true
    if (shape !== pattern && pattern !== '+' && shape !== '+') return false
  }
  if (patternArray.length > shapeArray.length) {
    return patternArray[length] === '#'
  }
  if (patternArray.length < shapeArray.length) {
    return shapeArray[length] === '#'
  }
  return true
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
module.exports.intersect = intersect
module.exports.mqttExtract = mqttExtract
