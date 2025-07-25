//
// This is authenticate router example
//

const Router = require('../index')
const TopicPattern = require('../lib/topic_pattern')
const program = require('commander')

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

const app = new Router()
app.setLogTrace(true)

const WampAuth = function () {
  this.getAuthMethods = function () {
    return ['ticket']
  }
  // user login
  this.ticket_auth = function (realmName, secureDetails, secret, extra, cb) {
    console.log('TICKET_AUTH:', secureDetails, secret, extra)
    app.getRealm(realmName, (realm) => {
      const api = realm.wampApi()
      let found = false
      // check user in own table
      api.subscribe(
        'sys.user.info.' + secureDetails.authid,
        (id, args, kwargs) => {
          console.log('ticket_auth:', id, args, kwargs)
          const userInfo = args[0]
          if (userInfo.password === secret) {
            cb(undefined, userInfo)
          } else {
            cb(new Error('authentication_failed'))
          }
          found = true
        },
        { retained: true }
      ).then((subId) => {
        console.log('ticket_auth: subscribed', found)
        if (!found) {
          cb(new Error('authentication_failed'))
        }
        api.unsubscribe(subId)
      })
    })
  }
  this.wampcra_extra = function (realmName, secureDetails, cb) {
    cb(undefined, 'some-random-string')
  }
  this.wampcra_auth = function (realmName, secureDetails, secret, extra, cb) {
    console.log(realmName, secureDetails, secret, extra)
  }
  // authorize each command access to particular URI
  this.authorize = function (session, funcClass, uniUri) {
    const userDetails = session.getUserDetails()
    console.log('authorize:', funcClass, uniUri, 'userDetails:', userDetails)
    if (userDetails.role === 'admin') {
      return true
    } else {
      return !TopicPattern.intersect(uniUri, ['sys', 'user', 'info', '#'])
    }
  }
}

app.getRealm('realm1', async (realm) => {
  var api = realm.wampApi()
  // create demo user table
  await api.publish('sys.user.info.joe', [{ role: 'user', password: 'joe-secret' }], null, { retain: true })
  await api.publish('sys.user.info.admin', [{ role: 'admin', password: 'admin-secret' }], null, { retain: true })
})

console.log('Listening port:', program.port)
app.listenWAMP({ port: program.port }, new WampAuth())
