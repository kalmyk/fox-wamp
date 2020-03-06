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
  session.log('Session open.', details)

  function waitForLockResource () {
    session.publish(
      'myapp.resource',
      [],
      { pid: process.pid, value: 'handle-resource' },
      { acknowledge: true, retain: true, trace: true, when: null, will: null, watch: true }
    ).then(
      (result) => {
        console.log('Resource Locked', result)
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
      { acknowledge: true, retain: true, trace: true }
    ).then(() => {
      setTimeout(
        waitForLockResource,
        1000
      )  
    })
  }

  // Define an event handler
  function onEvent (publishArgs, kwargs, opts) {
    console.log('Event', opts.topic, 'received args', publishArgs, 'kwargs ', kwargs)
  }

  // Subscribe to a topic
  session.subscribe('myapp.resource', onEvent, { retained: true }).then(
    function (subscription) {
      console.log('subscription successfull', subscription.topic)
    },
    function (error) {
      console.log('subscription failed', error)
    }
  )

  waitForLockResource()
}

connection.onclose = function (reason, details) {
  console.log('disconnected', reason, details)
}

connection.open()
