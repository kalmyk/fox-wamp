//
// This is authenticate router example
//

var Router = require('../index')
var program = require('commander')

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

let app
let Auth = function () {
  this.authTicket = function (realmName, secureDetails, secret, callback) {
    console.log('AUTH:', secureDetails, secret)
    app.getRealm(realmName, (realm) => {
        let api = realm.wampApi()
        let found = false
        api.subscribe('sys.user.'+secureDetails.authid, (id, args, kwargs) => {
          if (kwargs.password === secret) {
            callback()
          } else {
            callback(new Error('authentication_failed'))
          }
          found = true
        }).then((subId) => {
          if (!found) {
            callback(new Error('authentication_failed'))
          }
          api.unsubscribe(subId)
        })
    })
  }
}

app = new Router(new Auth())
app.setLogTrace(true)

app.getRealm('realm1', function (realm) {
  var api = realm.wampApi()
  api.publish('sys.user.joe', [], { password: 'joe-secret' }, { retain:true })
})

console.log('Listening port:', program.port)
app.listenWAMP({ port: program.port })
