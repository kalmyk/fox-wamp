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

let connection = new autobahn.Connection({
  url: program.server,
  realm: 'realm1',
  authmethods: ['ticket', 'wampcra'],
  authid: user,
  tlsConfiguration: {},
  onchallenge: onchallenge
})

connection.onopen = function (session, details) {
  session.log('Session open.')

  var starttime = Date.now()
  var c1 = session.call('com.timeservice.now', [], {}, { receive_progress: true }).then(
    function (now) {
      // this method returns a plain value
      session.log(
        'Call com.timeservice.now completed in ' +
        (Date.now() - starttime) +
        ' ms: result =', now
      )
    },
    function (error) {
      console.log('Call failed:', error)
    },
    function (progress) {
      console.log('Call progress:', progress)
    }
  )

  session.call('com.echoservice.echo').then(
    function (res) {
      // This method returns an autobahn.result object
      session.log(
        'Call com.echoservice.echo completed in ' +
        (Date.now() - starttime) +
        ' ms: result ' + ((res == null) ? 'OK' : 'Failed!')
      )
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  session.call('com.echoservice.echo', [], {}).then(
    function (res) {
      // This method returns an autobahn.result object
      session.log(
        'Call com.echoservice.echo completed in ' +
        (Date.now() - starttime) +
        ' ms: result ' + ((res == null) ? 'OK' : 'Failed!')
      )
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  session.call('com.echoservice.echo', ['arg1', 'arg2'], { 'kwarg1': 'kwarg1', 'kwarg2': 'kwarg2' }).then(
    function (res) {
      // This method returns an autobahn.result object
      session.log('Call com.echoservice.echo completed in ' +
        (Date.now() - starttime) +
        ' ms: result', res, 'expected', ['arg1', 'arg2'], { 'kwarg1': 'kwarg1', 'kwarg2': 'kwarg2' }
      )
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  session.call('test.foo', ['test'], { foo: 'bar' }).then(
    function (res) {
      session.log('Call test.foo completed in ' +
        (Date.now() - starttime) +
        ' ms: result =', res)
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  // Start publishing events
  console.log('Publish events')
  session.publish('com.myapp.topic1', [], {}, { acknowledge: false, trace: true })
  session.publish('com.myapp.topic1', [ 'Arg1', 'Arg2' ], { 'kwarg1': 'kwarg1', 'kwarg2': 'kwarg2' }, { acknowledge: false, trace: true })

  var p1 = session.publish('com.myapp.topic1', [ 'Arg_1', 'Arg_2' ], {}, { acknowledge: true }).then(
    function (publication) {
      console.log('published:', publication)
    },
    function (error) {
      console.log('publication error', error)
      return Promise.resolve(true)
    }
  )

  // when progressive call and acknowledge publish done
  Promise.all([c1, p1]).then(function () {
    connection.close()
  })
}

connection.onclose = function (reason, details) {
  console.log('disconnected', reason, details)
}

connection.open()
