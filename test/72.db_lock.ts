import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { withWriteLock } from '../lib/sqlite/db_lock'

describe('72.db_lock', function () {
  let db: sqlite.Database
  let dbOther: sqlite.Database
  let warnings: any[][]
  let origWarn: (...args: any[]) => void

  beforeEach(async () => {
    db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    dbOther = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    warnings = []
    origWarn = console.warn
    console.warn = (...args: any[]) => { warnings.push(args) }
  })

  afterEach(async () => {
    console.warn = origWarn
    await db.close()
    await dbOther.close()
  })

  it('serializes concurrent calls against the same db: no overlap, FIFO order', async () => {
    const order: string[] = []
    let inFlight = 0
    let maxInFlight = 0

    const run = (label: string, delayMs: number) => withWriteLock(db, async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      order.push(`${label}:start`)
      await new Promise(resolve => setTimeout(resolve, delayMs))
      order.push(`${label}:end`)
      inFlight--
    })

    await Promise.all([run('a', 20), run('b', 5), run('c', 5)])

    expect(maxInFlight).to.equal(1)
    expect(order).to.deep.equal(['a:start', 'a:end', 'b:start', 'b:end', 'c:start', 'c:end'])
  })

  it('does not serialize calls against a different db', async () => {
    const order: string[] = []

    const slow = withWriteLock(db, async () => {
      order.push('slow:start')
      await new Promise(resolve => setTimeout(resolve, 30))
      order.push('slow:end')
    })
    const fast = withWriteLock(dbOther, async () => {
      order.push('fast:start')
      order.push('fast:end')
    })

    await Promise.all([slow, fast])
    // fast (different db) completes without waiting for slow's db-scoped lock
    expect(order.indexOf('fast:end')).to.be.lessThan(order.indexOf('slow:end'))
  })

  it('a rejected write does not wedge the queue for the next writer', async () => {
    await expect(withWriteLock(db, async () => { throw new Error('boom') })).to.be.rejectedWith('boom')
    const result = await withWriteLock(db, async () => 'ok')
    expect(result).to.equal('ok')
  })

  it('logs a warning when a write exceeds warnAfterMs', async () => {
    await withWriteLock(db, () => new Promise(resolve => setTimeout(resolve, 30)), { label: 'slow-op', warnAfterMs: 10 })
    expect(warnings.length).to.equal(1)
    expect(warnings[0][0]).to.match(/slow write "slow-op"/)
  })

  it('does not log when a write stays under warnAfterMs', async () => {
    await withWriteLock(db, async () => 'fast', { label: 'fast-op', warnAfterMs: 10000 })
    expect(warnings.length).to.equal(0)
  })

  it('logs a warning (with the failure) when a write fails, still under warnAfterMs threshold', async () => {
    await expect(withWriteLock(db, async () => { throw new Error('nope') }, { label: 'failing-op' })).to.be.rejectedWith('nope')
    expect(warnings.length).to.equal(1)
    expect(warnings[0][0]).to.match(/failed write "failing-op"/)
  })

  it('a queued caller\'s reported wait time includes time spent behind an earlier slow write', async () => {
    const first = withWriteLock(db, () => new Promise(resolve => setTimeout(resolve, 30)), { label: 'first', warnAfterMs: 10000 })
    const second = withWriteLock(db, async () => 'second', { label: 'second', warnAfterMs: 10 })
    await Promise.all([first, second])
    expect(warnings.length).to.equal(1)
    expect(warnings[0][0]).to.match(/slow write "second": waited \d+ms/)
  })
})
