'use strict'

class KPQueue {
  constructor () {
    this.keyLock = new Map()
  }

  runDefer (strUri, defer) {
    defer.cb().then(
      (res) => { this.deQueue(strUri); defer.resolve(res) },
      (res) => { this.deQueue(strUri); defer.reject(res) }
    )
  }

  enQueue (strUri, cb) {
    let queue = this.keyLock.get(strUri)
    if (!queue) {
      queue = []
      this.keyLock.set(strUri, queue)
    }
    const defer = { cb }
    const result = new Promise ((resolve, reject) => {
      defer.resolve = resolve
      defer.reject = reject
    })
    queue.push(defer)
    if (queue.length == 1) {
      this.runDefer(strUri, defer)
    }
    return result
  }

  deQueue (strUri) {
    let queue = this.keyLock.get(strUri)
    if (!queue) {
      throw 'Queue-Error!'
    }
    queue.shift()
    if (queue.length > 0) {
      this.runDefer(strUri, queue[0])
    } else {
      this.keyLock.delete(strUri)
    }
  }
}

exports.KPQueue = KPQueue
