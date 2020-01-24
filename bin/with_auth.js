//
// This is authenticate router example
//

var Router = require('../index')
var TopicPattern = require('../lib/topic_pattern')
var program = require('commander')

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

let app
let WampAuth = function () {
  this.getAuthMethods = function () {
    return ['ticket']
  }
  this.ticket_auth = function (realmName, secureDetails, secret, extra, callback) {
    console.log('TICKET_AUTH:', secureDetails, secret, extra)
    app.getRealm(realmName, (realm) => {
      let api = realm.wampApi()
      let found = false
      api.subscribe('sys.user.info.'+secureDetails.authid, (id, args, kwargs) => {
        if (kwargs.password === secret) {
          callback(undefined, kwargs)
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
  this.authorize = function (session, funcClass, uniUri) {
    let userDetails = session.getUserDetails()
    console.log('authorize:', funcClass, uniUri, 'userDetails:', userDetails)
    if (userDetails.role === 'admin') {
      return true
    }
    else {
      return !TopicPattern.intersect(uniUri, ['sys', 'user', 'info', '#'])
    }
  }
}

app = new Router()
app.setLogTrace(true)

app.getRealm('realm1', function (realm) {
  var api = realm.wampApi()
  // create demo database
  api.publish('sys.user.info.joe', [], { role: 'user', password: 'joe-secret' }, { retain:true })
  api.publish('sys.user.info.admin', [], { role: 'admin', password: 'admin-secret' }, { retain:true })
})

console.log('Listening port:', program.port)
app.listenWAMP({ port: program.port }, new WampAuth())
