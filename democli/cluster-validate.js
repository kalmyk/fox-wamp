// Cluster ordering demo: validator side.
//
// Subscribes to a topic and checks two invariants on the incoming stream:
//   1. the server-assigned event id (WAMP publication id) is strictly
//      increasing across ALL received messages, regardless of which
//      thread/connection/entry-node published them (global order)
//   2. the `seq` carried in each message is strictly increasing within its
//      own `threadId` (per-thread order, and no gaps/loss)
//
// { threadId, seq } arrives as a positional WAMP arg (args[0]), not kwargs —
// see the matching note in democli/cluster-publish.js.
//
// Start this script FIRST - it must be subscribed before the publisher
// (democli/cluster-publish.js) starts, otherwise early messages are missed.
// It finishes either once it has seen --expect messages, or after
// --idle-timeout ms without receiving anything, and exits 0 on PASS / 1 on FAIL.
//
// Example:
//   node democli/cluster-validate.js -s ws://127.0.0.1:9031/wamp -n 1000000

const autobahn = require('autobahn')
const program = require('commander')

program
  .option('-s, --server <server>', 'Entry node WS URI to subscribe from', 'ws://127.0.0.1:9031/wamp')
  .option('-r, --realm <realm>', 'Realm name', 'realm1')
  .option('-t, --topic <topic>', 'Topic to subscribe to', 'com.test.cluster.volume')
  .option('-n, --expect <n>', 'Expected total message count (0 = unknown, rely on idle timeout only)', '1000000')
  .option('--idle-timeout <ms>', 'Milliseconds of silence before concluding', '60000')
  .option('--progress-every <n>', 'Log progress every N messages', '50000')
  .parse(process.argv)

const server = program.server
const realm = program.realm
const topic = program.topic
const expect = parseInt(program.expect, 10)
const idleTimeoutMs = parseInt(program.idleTimeout, 10)
const progressEvery = parseInt(program.progressEvery, 10)

// Compares two event ids. The masterfree cluster hands out lexicographically
// sortable string ids (segment + zero-width-prefixed base36 offset, see
// lib/masterfree/makeid.ts); a plain single-node engine hands out plain
// decimal-integer strings. Handle both.
function idGreater (a, b) {
  const na = Number(a)
  const nb = Number(b)
  if (String(na) === String(a) && String(nb) === String(b) && !Number.isNaN(na) && !Number.isNaN(nb)) {
    return na > nb
  }
  return String(a) > String(b)
}

let received = 0
let globalOrderViolations = 0
let lastGlobalId = null
const threadState = new Map() // threadId -> { lastSeq, count, reorders, gaps }

let firstMsgAt = null
let idleTimer = null
let finished = false

function resetIdleTimer () {
  if (idleTimeoutMs <= 0) return
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => finish('idle timeout - no message received for ' + idleTimeoutMs + 'ms'), idleTimeoutMs)
}

function onEvent (args, kwargs, details) {
  if (finished) return
  if (firstMsgAt === null) firstMsgAt = Date.now()
  received++

  const payload = (args && args[0]) || {}
  const threadId = payload.threadId
  const seq = payload.seq
  const pubId = details != null ? details.publication : undefined

  if (lastGlobalId !== null && pubId !== undefined && !idGreater(pubId, lastGlobalId)) {
    globalOrderViolations++
    console.error(`GLOBAL ORDER VIOLATION at message #${received}: id ${pubId} did not increase past ${lastGlobalId}`)
  }
  if (pubId !== undefined) lastGlobalId = pubId

  let st = threadState.get(threadId)
  if (!st) {
    st = { lastSeq: -1, count: 0, reorders: 0, gaps: 0 }
    threadState.set(threadId, st)
  }
  st.count++
  if (seq <= st.lastSeq) {
    st.reorders++
    console.error(`THREAD ORDER VIOLATION thread=${threadId}: seq ${seq} did not increase past ${st.lastSeq}`)
  } else if (seq !== st.lastSeq + 1) {
    st.gaps += (seq - st.lastSeq - 1)
  }
  st.lastSeq = seq

  resetIdleTimer()

  if (progressEvery > 0 && received % progressEvery === 0) {
    const elapsed = (Date.now() - firstMsgAt) / 1000
    console.log(`... ${received} messages received (${(received / elapsed).toFixed(0)} msg/s), ${threadState.size} threads seen`)
  }

  if (expect > 0 && received >= expect) {
    finish('reached expected count')
  }
}

function finish (reason) {
  if (finished) return
  finished = true
  clearTimeout(idleTimer)

  let totalGaps = 0
  let totalReorders = 0
  for (const st of threadState.values()) {
    totalGaps += st.gaps
    totalReorders += st.reorders
  }

  const countOk = expect === 0 || received === expect
  const ok = globalOrderViolations === 0 && totalReorders === 0 && totalGaps === 0 && countOk

  console.log('====================================')
  console.log('validation finished:', reason)
  console.log('total received:', received, expect > 0 ? `(expected ${expect})` : '')
  console.log('threads seen:', threadState.size)
  console.log('global order violations:', globalOrderViolations)
  console.log('per-thread reorder violations:', totalReorders)
  console.log('per-thread gaps (missing seq, possible loss):', totalGaps)
  if (!countOk) {
    console.log(`count mismatch: received ${received}, expected ${expect} (${expect - received} missing)`)
  }
  console.log('RESULT:', ok ? 'PASS' : 'FAIL')

  try { connection.close() } catch (err) { console.error('connection.close() failed (ignored):', err.message) }
  process.exit(ok ? 0 : 1)
}

const connection = new autobahn.Connection({ url: server, realm })

connection.onopen = function (session) {
  session.subscribe(topic, onEvent).then(
    function (subscription) {
      console.log(`READY - subscribed to ${topic} on ${server}, waiting for messages...`)
      resetIdleTimer()
    },
    function (error) {
      console.error('subscription failed', error)
      process.exit(1)
    }
  )
}

connection.onclose = function (reason, details) {
  if (!finished) {
    console.error('connection closed unexpectedly:', reason, details)
    finish('connection closed')
  }
  return true
}

connection.open()
