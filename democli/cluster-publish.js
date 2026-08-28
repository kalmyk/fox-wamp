// Cluster ordering demo: publisher side.
//
// Opens N concurrent WAMP connections ("threads") and publishes a fixed
// total number of messages spread across them. Each message carries
// { threadId, seq } as a positional WAMP arg (args[0]), not kwargs — the
// masterfree/NetEngine storage and live-dispatch pipeline does not currently
// preserve kwargs (WAMP CALL/PUBLISH "hdr") end-to-end, only args/data, so
// kwargs would silently arrive as undefined at the validator. See
// democli/cluster-validate.js for the matching args[0] read.
// democli/cluster-validate.js can verify from this:
//   1. globally increasing server-assigned event ids across all threads
//   2. strictly increasing per-thread `seq` (no reordering/loss within a thread)
//
// Start cluster-validate.js FIRST (it needs to be subscribed before
// publishing starts), then run this script.
//
// Example against the masterfree.supervisord.ini demo cluster (3 entry nodes):
//   node democli/cluster-publish.js \
//     -s ws://127.0.0.1:9031/wamp,ws://127.0.0.1:9032/wamp,ws://127.0.0.1:9033/wamp \
//     -c 100 -n 1000000

const autobahn = require('autobahn')
const program = require('commander')

program
  .option('-s, --servers <servers>', 'Comma-separated entry node WS URIs (round-robin across threads)', 'ws://127.0.0.1:9031/wamp,ws://127.0.0.1:9032/wamp,ws://127.0.0.1:9033/wamp')
  .option('-r, --realm <realm>', 'Realm name', 'realm1')
  .option('-t, --topic <topic>', 'Topic to publish volume to', 'com.test.cluster.volume')
  .option('-c, --connections <n>', 'Number of concurrent connections (threads)', '100')
  .option('-n, --total <n>', 'Total number of messages to publish across all connections', '1000000')
  .option('--in-flight <n>', 'Max un-acked publishes in flight per connection', '50')
  .parse(process.argv)

const servers = program.servers.split(',').map(s => s.trim()).filter(Boolean)
const numConnections = parseInt(program.connections, 10)
const total = parseInt(program.total, 10)
const inFlightLimit = parseInt(program.inFlight, 10)
const topic = program.topic
const realm = program.realm

if (servers.length === 0) {
  console.error('no servers given')
  process.exit(1)
}

// Split total as evenly as possible across connections; earlier threads
// absorb the remainder.
function countFor (threadId) {
  const base = Math.floor(total / numConnections)
  const rem = total % numConnections
  return base + (threadId < rem ? 1 : 0)
}

let sentTotal = 0
let failedTotal = 0

function runThread (threadId) {
  const server = servers[threadId % servers.length]
  const count = countFor(threadId)

  return new Promise((resolve) => {
    if (count === 0) {
      resolve({ threadId, sent: 0, failed: 0 })
      return
    }

    const connection = new autobahn.Connection({ url: server, realm })

    connection.onopen = function (session) {
      let seq = 0
      let inFlight = 0
      let sent = 0
      let failed = 0

      function pump () {
        if (seq >= count) {
          if (inFlight === 0) {
            connection.close()
          }
          return
        }
        while (inFlight < inFlightLimit && seq < count) {
          const mySeq = seq++
          inFlight++
          session.publish(topic, [{ threadId, seq: mySeq }], {}, { acknowledge: true }).then(
            function () {
              sent++
              sentTotal++
            },
            function (err) {
              failed++
              failedTotal++
              console.error(`thread ${threadId} publish failed at seq ${mySeq}:`, err && err.error ? err.error : err)
            }
          ).then(function () {
            inFlight--
            pump()
          })
        }
      }

      pump()

      connection.onclose = function () {
        resolve({ threadId, sent, failed, server })
        return true
      }
    }

    connection.onclose = function (reason, details) {
      // fired if the connection never opens (e.g. server unreachable)
      resolve({ threadId, sent: 0, failed: count, server, reason, details })
      return true
    }

    connection.open()
  })
}

async function main () {
  console.log(`publishing ${total} messages across ${numConnections} connections over ${servers.length} server(s)`)
  console.log(`topic: ${topic}, realm: ${realm}`)

  const start = Date.now()
  const progressTimer = setInterval(() => {
    const elapsed = (Date.now() - start) / 1000
    console.log(`... sent ${sentTotal}/${total} (${failedTotal} failed) - ${(sentTotal / elapsed).toFixed(0)} msg/s`)
  }, 2000)

  const threads = []
  for (let i = 0; i < numConnections; i++) {
    threads.push(runThread(i))
  }

  const results = await Promise.all(threads)
  clearInterval(progressTimer)

  const elapsed = (Date.now() - start) / 1000
  console.log('====================================')
  console.log(`done in ${elapsed.toFixed(1)}s - sent ${sentTotal}, failed ${failedTotal} - ${(sentTotal / elapsed).toFixed(0)} msg/s`)
  const badThreads = results.filter(r => r.failed > 0 || (r.reason && r.reason !== 'closed'))
  if (badThreads.length > 0) {
    console.log(`${badThreads.length} thread(s) had failures/connection issues`)
  }
  process.exit(failedTotal > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('fatal error:', err)
  process.exit(1)
})
