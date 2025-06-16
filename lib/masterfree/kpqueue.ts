class Deferred {
  public resolve: (value?: any) => void
  public reject: (reason?: any) => void
  public cb: () => Promise<any>
  constructor (cb: () => Promise<any>) {
    this.cb = cb
    this.resolve = () => {}
    this.reject = () => {}
  }
}

// key promise queue
// one only unresolved promise in queue under key/uri
export class KPQueue {
  private keyLock: Map<string, any[]> = new Map() // of uri, queue of defer objects

  // private
  runDefer (strUri: string, defer: Deferred) {
    defer.cb().then(
      (res) => { this.deQueue(strUri); defer.resolve(res) },
      (res) => { this.deQueue(strUri); defer.reject(res) }
    )
  }

  // @return promise
  enQueue (strUri: string, cb: () => Promise<any>): Promise<any> {
    let queue = this.keyLock.get(strUri)
    if (!queue) {
      queue = []
      this.keyLock.set(strUri, queue)
    }
    const defer = new Deferred(cb)
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

  deQueue (strUri: string) {
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
