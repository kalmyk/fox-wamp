'use strict'

class QuorumEdge {
  constructor (notify, reduce) {
    this.waitFor = new Map()
    this.notify = notify
    this.reduce = reduce
    this.limit = 2
    this.members = new Map()
  }

  setLimit(limit) {
    this.limit = limit
  }

  addMember (member) {
    this.members.set(member)
  }

  delMember (member) {
    this.members.delete(member)
  }

  vote(member, topic, value) {
    let item
    if (this.waitFor.has(topic)) {
      item = this.waitFor.get(topic)
      if (!item.done) {
        item.value = this.reduce(item.value, value)
      }
    } else {
      item = {
        value,
        members: [],
        done: false
      }
      this.waitFor.set(topic, item)
    }
    item.members.push(member)
    if (item.members.length >= this.limit && !item.done) {
      item.done = true
      this.notify(topic, item.value)
    }
    if (item.members.length >= this.members.size) {
      this.waitFor.delete(topic)
    }
  }
}

exports.QuorumEdge = QuorumEdge
