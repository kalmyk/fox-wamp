// AUTOBAHN_DEBUG = true;
const autobahn = require('autobahn')
const program = require('commander')

program
  .option('-s, --server <server>', 'Server URI address', 'ws://127.0.0.1:9000/wamp')
  .parse(process.argv)

console.log('connect to server:', program.server)

var connection = new autobahn.Connection({
  url: program.server,
  realm: 'realm1'
})

connection.onopen = function (session, details) {
  session.log('Session open.')

  session.subscribe('wamp.session.#', function (publishArgs, kwargs, opts) {
    console.log('Event', opts.topic, 'received args', publishArgs, 'kwargs ', kwargs)
  }).then(
    function (subscription) {
      console.log('subscription successfull wamp.session.on_join')
    }
  )

  session.call('wamp.registration.get').then(
    function (result) {
      session.log('registration.get =', typeof (result), result)
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  session.call('wamp.session.count').then(
    function (result) {
      session.log('count =', typeof (result), result)
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )

  var sessions = null
  session.call('wamp.session.list').then(
    function (result) {
      sessions = result
      session.log('list =', typeof (result), result)

      session.call('wamp.session.get', [sessions[0]]).then(
        function (result) {
          session.log('get =', typeof (result), result)
        },
        function (error) {
          console.log('Call failed:', error)
        }
      )
    },
    function (error) {
      console.log('Call failed:', error)
    }
  )
}

connection.onclose = function (reason, details) {
  console.log('disconnected', reason, details)
}

connection.open()
