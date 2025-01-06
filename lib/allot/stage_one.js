'use strict'

const { EventEmitter } = require('events')

const SO_ON_ID_PAIR = 'SO_ON_ID_PAIR';
const SO_EXTRACT = 'SO_EXTRACT';

class StageOne extends EventEmitter {
  constructor (majorLimit) {
    super()
    this.majorLimit = majorLimit
    this.recentValue = ''
    this.topicHeap = new Map()
    this.doneHeap = new Map()
    this.expectantHeap = new Set()

    this.on(SO_ON_ID_PAIR, this.onIdPair)
  }

  getRecentValue () {
    return this.recentValue
  }

  setRecentValue (newRecentValue) {
    if (this.recentValue > newRecentValue) {
      throw Error('failed to set recentValue: "'+this.recentValue+'">"'+newRecentValue+'"')
    }
    this.recentValue = newRecentValue
  }

  onIdPair(vouter, topic, expectant) {
    this.expectantHeap.add(expectant)

    if (this.doneHeap.has(topic)) {
      const vouterSet = this.doneHeap.get(topic)
      vouterSet.add(vouter)
      while (this.expectantHeap.size > this.topicHeap.size) {
        this.shiftExpectant()
      }
      return
    } 
    
    if (!this.topicHeap.has(topic)) {
      this.topicHeap.set(topic, new Set())
    }
    const vouterSet = this.topicHeap.get(topic)
    vouterSet.add(vouter)

    while (this.expectantHeap.size > this.topicHeap.size) {
      this.shiftExpectant()
    }

    if (vouterSet.size >= this.majorLimit) {
      this.topicHeap.delete(topic)
      this.doneHeap.set(topic, vouterSet)
      const extract = this.shiftExpectant()
      this.emit(SO_EXTRACT, topic, extract)
    }
  }

  shiftExpectant() {
    let minValue
    for (const cur of this.expectantHeap.values()) {
      minValue = minValue && minValue < cur ? minValue : cur
    }
    this.expectantHeap.delete(minValue)
    this.recentValue = minValue
    return minValue
  }
}

exports.StageOne = StageOne
exports.SO_ON_ID_PAIR = SO_ON_ID_PAIR
exports.SO_EXTRACT = SO_EXTRACT
