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
    session.publish(
      'myapp.resource',
      [],
      { comment: 'any values in KWARGS', pid: process.pid, value: 'handle-resource' },
      { acknowledge: true, retain: true, when: null, will: null, watch: true }
    ).then(
      (result) => {
        console.log('Master Resource Locked', result)
        setTimeout(
          unlockResource,
          5000
        )
      }, (reason) => {
        console.log('FAILED', reason)
        connection.close()
      }
    )
  }

  function unlockResource () {
    console.log('Send Unlock by timeout')
    session.publish(
      'myapp.resource',
      [],
      null,
      { acknowledge: true, retain: true }
    ).then(() => {
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
