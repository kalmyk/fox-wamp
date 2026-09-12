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

// Key Promise Queue
// one started promise in the queue under key/uri
//
// This is a per-key JS-level critical section, not a replacement for (or duplicate of)
// db_lock's `withWriteLock`, which is a per-connection lock keyed by the `sqlite.Database`
// object. The two guard different things and both are needed wherever they're used together
// (see DbEngine.updateKvFromActor / applyKvActorLocked in lib/mono/dbengine.ts):
//   - withWriteLock only wraps the actual write statements inside SqliteKvFabric.writeKvLocked,
//     to stop the sqlite driver's "cannot start a transaction within a transaction" error when
//     unrelated modules sharing one connection write at the same time.
//   - KPQueue wraps the *whole* read-modify-write cycle for one key (read old value, check
//     `when`, merge, write, then resolve/chain any parked "watch" actors for that same key) so
//     two concurrent updates to the same URI can't both read the same stale value before either
//     writes (a lost-update race that withWriteLock's connection-level lock does not prevent,
//     since the read happens before the write lock is acquired).
// Note also that collapsing this into another `withWriteLock(db, ...)` call around the outer
// cycle would deadlock: writeKvLocked already calls withWriteLock on the same db, and
// withWriteLock's per-db promise chain isn't reentrant.
export class KPQueue {
  private keyLock: Map<string, any[]> = new Map() // of uri, queue of defer objects

  get size (): number { return this.keyLock.size }
  hasKey (key: string): boolean { return this.keyLock.has(key) }

  private runDefer (strUri: string, defer: Deferred) {
    defer.cb().then(
      (res) => { this.deQueue(strUri); defer.resolve(res) },
      (res) => { this.deQueue(strUri); defer.reject(res) }
    )
  }

  // @return promise
  enQueue (strUri: string, cb: () => Promise<any>): Promise<any> {
    let queue: Deferred[] | undefined = this.keyLock.get(strUri)
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

  // private
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
