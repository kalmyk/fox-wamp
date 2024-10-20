'use strict'

function mqttParse (topic) {
  let result = String(topic).split('/')
  for (let i = 0; i < result.length; i++) {
    if (result[i] === '+') {
      result[i] = '*'
    }
  }
  return result
}

function wampUriParse (topic) {
  return String(topic).split('.')
}

function defaultParse (topic) {
  return String(topic).split('.')
}

function restoreUri (topic) {
  return topic.join('.')
}

function restoreMqttUri (topic) {
  return topic.join('/')
}

function mqttMatch (topic, filter) {
  return match(mqttParse(topic), mqttParse(filter))
}

function wampMatch (topic, filter) {
  return match(wampUriParse(topic), wampUriParse(filter))
}

function isPattern (topic) {
  for (let i = 0; i < topic.length; i++) {
    if (topic[i] === '*' || topic[i] === '#') {
      return true
    }
  }
  false
}

// match topic to pattern
function match (topicArray, patternArray) {
  const length = patternArray.length

  for (var i = 0; i < length; ++i) {
    let pattern = patternArray[i]
    let topic = topicArray[i]
    if (pattern === '#') return topicArray.length >= length - 1
    if (pattern !== '*' && pattern !== topic) return false
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
    if (shape !== pattern && pattern !== '*' && shape !== '*') return false
  }
  if (patternArray.length > shapeArray.length) {
    return patternArray[length] === '#'
  }
  if (patternArray.length < shapeArray.length) {
    return shapeArray[length] === '#'
  }
  return true
}

function extract (topicArray, patternArray) {
  var res = []
  const length = patternArray.length

  for (var i = 0; i < length; ++i) {
    let pattern = patternArray[i]
    if (pattern === '#') {
      if (i <= topicArray.length) {
        return res.concat(topicArray.slice(i))
      } else {
        return null
      }
    }
    let topic = topicArray[i]
    if (pattern === '*') {
      res.push(topic)
    } else if (pattern !== topic) {
      return null
    }
  }
  if (length === topicArray.length) {
    return res
  } else {
    return null
  }
}

function mqttExtract (topic, pattern) {
  return extract(mqttParse(topic), mqttParse(pattern))
}

function merge (topicArray, patternArray) {
  var res = []
  const length = patternArray.length

  let k = 0
  for (var i = 0; i < length; ++i) {
    let pattern = patternArray[i]
    if (pattern === '#') {
      if (k <= topicArray.length) {
        return res.concat(topicArray.slice(k))
      } else {
        return null
      }
    }
    let topic = topicArray[k]
    if (pattern === '*') {
      res.push(topic)
      k++
    } else {
      res.push(pattern)
    }
  }
  return res
}

exports.mqttParse = mqttParse
exports.mqttMatch = mqttMatch
exports.restoreUri = restoreUri
exports.restoreMqttUri = restoreMqttUri
exports.defaultParse = defaultParse

exports.wampUriParse = wampUriParse
exports.wampMatch = wampMatch
exports.isPattern = isPattern

exports.match = match
exports.extract = extract
exports.merge = merge
exports.intersect = intersect
exports.mqttExtract = mqttExtract
