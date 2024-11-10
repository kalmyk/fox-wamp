// AUTOBAHN_DEBUG = true;
const autobahn = require('autobahn')
const program = require('commander')

program
  .option('-s, --server <server>', 'Server URI address', 'ws://127.0.0.1:9000/wamp')
  .parse(process.argv)

console.log('connect to server:', program.server)

var user = 'joe'
var key = 'joe-secret'

// this callback is fired during authentication
function onchallenge (session, method, extra) {
  if (method === 'ticket') {
    return key
  }
  else if (method === 'wampcra') {
    return autobahn.auth_cra.sign(key, extra.challenge)
  }
  else {
    throw Error("don't know how to authenticate using '" + method + "'")
  }
}

const connection = new autobahn.Connection({
  url: program.server,
  realm: 'realm1',
  authmethods: ['ticket', 'wampcra'],
  authid: user,
  tlsConfiguration: {},
  onchallenge: onchallenge
})

connection.onopen = function (session, details) {
  session.log('Session open.')

  function waitForLockResource () {
    console.log('waiting for lock...')
    session.publish(
      'myapp.resource',
      [{ any: 'object', pid: process.pid, value: 'handle-resource' }],
      { any: 1 },
      { acknowledge: true, retain: true, when: null, will: null, watch: true }
    ).then(
      (result) => {
        console.log('Master Resource Locked:', result)
        setTimeout(
          unlockResource,
          9000
        )
      }, (reason) => {
        console.log('Lock FAILED', reason)
        connection.close()
      }
    )
  }

  function unlockResource () {
    console.log('Send Unlock by timeout')
    session.publish(
      'myapp.resource',
      null,
      { header: 'any' },
      { acknowledge: true, retain: true }
    ).then(() => {
      console.log('unlock has been published, wait for 1 sec to next lock attempt')
      setTimeout(
        waitForLockResource,
        1000
      )
    })
  }

  waitForLockResource()
}

connection.onclose = function (reason, details) {
  console.log('disconnected', reason, details)
}

connection.open()
