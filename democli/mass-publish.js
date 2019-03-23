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
  } else {
    throw "don't know how to authenticate using '" + method + "'"
  }
}

var connection = new autobahn.Connection({
  url: program.server,
  realm: 'realm1',
  authmethods: ['ticket', 'wampcra'],
  authid: user,
  tlsConfiguration: {},
  onchallenge: onchallenge
})

const msgCount = 100000

connection.onopen = function (session, details) {

  session.log("Session open.")

  var starttime = Date.now()
  var res = []
  for (var i=0; i<msgCount; i++) {
    res.push(session.publish('com.myapp.topic1', [], {field1:'some long value', field2:12345}, { acknowledge : true }).then(
      function(publication) {
        // console.log("published, publication ID is ", publication);
      },
      function(error) {
        console.log("publication error", error)
        return Promise.resolve(true)
      }
    ))
  }

  // when progressive call and acknowledge publish done
  Promise.all(res).then(function () {
    console.log('total rec/sec:', msgCount/(Date.now() - starttime)*1000 )
    connection.close();
  })
}

connection.onclose = function (reason, details) {
  console.log("close connection:", reason, details)
}

connection.open()
