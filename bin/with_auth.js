//
// This is authenticate router example
//

var Router = require('../index')
var program = require('commander')

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

var Auth = function () {
  this.authTicket = function (realmName, secureDetails, secret, callback) {
    console.log('AUTH:', secureDetails, secret)
    if (secureDetails.authid + '-secret' === secret) {
      callback()
    } else {
      callback(new Error('authorization_failed'))
    }
  }
}

console.log('Listening port:', program.port)

var app = new Router(new Auth())
app.setLogTrace(true)
app.listenWAMP({ port: program.port })
