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

  vote(member, id, value) {
    let item
    if (this.waitFor.has(id)) {
      item = this.waitFor.get(id)
      if (!item.done) {
        this.reduce(item.value, value)
      }
    } else {
      item = {
        value,
        members: [],
        done: false
      }
      this.waitFor.set(id, item)
    }
    item.members.push(member)
    if (item.members.length >= this.limit && !item.done) {
      item.done = true
      this.notify(id, item.value)
    }
    if (item.members.length >= this.members.size) {
      this.waitFor.delete(id)
    }
  }
}

exports.QuorumEdge = QuorumEdge
