// AUTOBAHN_DEBUG = true;
const autobahn = require('autobahn')
const program = require('commander')

program
  .option('-s, --server <server>', 'Server URI address', 'ws://127.0.0.1:9000/wamp')
  .parse(process.argv)

console.log('connect to server:', program.server)

let user = 'joe'
let key = 'joe-secret'

// this callback is fired during authentication
function onchallenge (session, method, extra) {
  if (method === 'ticket') {
    return key
  }
  else if (method === 'wampcra') {
    return autobahn.auth_cra.sign(key, extra.challenge)
  }
  else {
    throw new Error("don't know how to authenticate using '" + method + "'")
  }
}

var connection = new autobahn.Connection({
  url: program.server,
  realm: 'realm1',
  authmethods: ['ticket', 'wampcra'],
  authid: user,
  authextra: {extra1:1},
  tlsConfiguration: {},
  onchallenge: onchallenge
})

connection.onopen = function (session) {
  var reg = null
  var reg2 = null

  function utcprogress (args, kwargs, options) {
    console.log('Someone is calling utc function', args, kwargs, options)
    var now = new Date()
    if (options.progress) {
      options.progress([now.toISOString()])
      setTimeout(function () {
        var now = new Date()
        options.progress([now.toISOString()])
      }, 100)
      return new Promise((resolve, reject) => {
        setTimeout(function () {
          var now = new Date()
          resolve([now.toISOString()])
        }, 200)
      })
    } else {
      return now.toISOString()
    }
  }

  session.register('com.timeservice.now', utcprogress).then(
    function (registration) {
      console.log('Procedure registered:', registration.id)
      reg = registration
    },
    function (error) {
      console.log('Registration failed:', error)
    }
  )

  function echo (args, kwargs) {
    console.log('args', args, 'kwargs', kwargs)
    return new autobahn.Result(args, kwargs)
    // throw new Error("inside backend!")
    // return new autobahn.Error('Error-text', ['error-args'])   // no error delivered to router, possible bug in autobahn
  }

  session.register('com.echoservice.echo', echo).then(
    function (registration) {
      console.log('Procedure echo registered:', registration.id)
      reg2 = registration
    },
    function (error) {
      console.log('Registration failed:', error)
    }
  )

  // Define an event handler
  function onEvent (publishArgs, kwargs, opts) {
    console.log('Event', opts.topic, 'received args', publishArgs, 'kwargs', kwargs, 'opts', opts)
  }

  // Subscribe to a topic
  session.subscribe('com.myapp.topic1', onEvent/*, {filter:{type:1}}*/).then(
    function (subscription) {
      console.log('subscription successfull', subscription.topic)
    },
    function (error) {
      console.log('subscription failed', error)
    }
  )

  session.subscribe('sys.user.#', onEvent).then(
    function (subscription) {
      console.log('user subscription passed', subscription.topic)
    },
    function (error) {
      console.log('access to user password is denied')
    }
  )

  setTimeout(
    function () {
      console.log('Unregistration')
      session.unregister(reg)
      session.unregister(reg2)
    },
    20000
  )
}

connection.onclose = function (reason, details) {
  console.log('disconnected', reason, details)
}

connection.open()
