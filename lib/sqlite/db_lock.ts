import * as sqlite from 'sqlite'

// node-sqlite3 (and the `sqlite` wrapper around it) serialize everything onto one connection,
// but allow only one write/transaction in flight at a time: if a second caller issues
// `BEGIN TRANSACTION` while another explicit transaction on the *same connection* is still
// open, sqlite raises "cannot start a transaction within a transaction". That bug was first
// hit and fixed inside EventStorageTask alone (two of its own methods sharing one private
// lock) — but the same `sqlite.Database` (one open file) is also written to, independently and
// unlocked, by ProjectionListener/KvProjection, SchemaRepository, StorageRegistry and
// SqliteKvFabric wherever they share a DbFactory's main db (see bin/masterfree/ndb.ts). Any pair of
// those can race the same way. The fix has to live at the connection, not inside one class.
//
// Keying by the `sqlite.Database` object itself (via WeakMap, so an unused db can still be GC'd)
// means every writer holding a reference to the same open connection serializes against every
// other, regardless of which module/class issued the call — a `sqlite.Database` here always
// corresponds to exactly one open file, so this is effectively a per-database-file lock.
const locks = new WeakMap<sqlite.Database, Promise<void>>()

export type WriteLockOptions = {
  // Identifies the call site in slow/failed-write log lines. Keep it short and stable,
  // e.g. 'storage.dbSaveSegment', 'schema.add', 'kvProjection.applyEvent'.
  label?: string
  // Log a warning when either the queue wait or the write itself reaches this many ms.
  // A high wait consistently for one label points at lock contention (too much serialized
  // through one connection); a high run time points at a slow query/transaction itself.
  warnAfterMs?: number
}

const DEFAULT_WARN_AFTER_MS = 200

// Runs fn() once every earlier write queued against this same db has settled, so at most one
// write (and its awaits) is ever in flight on the connection at a time. Serializes strictly by
// arrival order (FIFO) — no priority between callers/labels.
export function withWriteLock<T> (db: sqlite.Database, fn: () => Promise<T>, opts: WriteLockOptions = {}): Promise<T> {
  const label = opts.label ?? 'write'
  const warnAfterMs = opts.warnAfterMs ?? DEFAULT_WARN_AFTER_MS
  const queuedAt = Date.now()
  const prior = locks.get(db) ?? Promise.resolve()

  const scheduled = prior.then(async () => {
    const waitMs = Date.now() - queuedAt
    const startedAt = Date.now()
    try {
      const result = await fn()
      const runMs = Date.now() - startedAt
      if (waitMs >= warnAfterMs || runMs >= warnAfterMs) {
        console.warn(`[db-lock] slow write "${label}": waited ${waitMs}ms, ran ${runMs}ms`)
      }
      return result
    } catch (err) {
      const runMs = Date.now() - startedAt
      console.warn(`[db-lock] failed write "${label}" after ${runMs}ms (waited ${waitMs}ms):`, (err as Error).message)
      throw err
    }
  })

  // The tracked lock state itself must always resolve — a rejected write must not wedge the
  // queue for subsequent writers — while the caller still observes the original rejection via
  // the returned `scheduled` promise.
  locks.set(db, scheduled.then(() => undefined, () => undefined))
  return scheduled
}
