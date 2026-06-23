import FoxRouter from '../lib/fox_router'
import { BaseRealm } from '../lib/realm'
import { Session } from '../lib/session'
import { intersect } from '../lib/topic_pattern'
import program from 'commander'

program
  .option('-p, --port <port>', 'Server IP port', '9000')
  .parse(process.argv)

const app = new FoxRouter()
app.setLogTrace(true)

class WampAuth {
  getAuthMethods(): string[] {
    return ['ticket']
  }

  ticket_auth(realmName: string, secureDetails: any, secret: string, extra: any, cb: (err?: Error, userInfo?: any) => void): void {
    console.log('TICKET_AUTH:', secureDetails, secret, extra)
    app.getRealm(realmName, (realm: BaseRealm) => {
      const api = realm.wampApi()
      let found = false
      api.subscribe(
        'sys.user.info.' + secureDetails.authid,
        (_id: any, args: any[], _kwargs: any) => {
          console.log('ticket_auth:', _id, args, _kwargs)
          const userInfo = args[0]
          if (userInfo.password === secret) {
            cb(undefined, userInfo)
          } else {
            cb(new Error('authentication_failed'))
          }
          found = true
        },
        { retained: true }
      ).then((subId: string) => {
        console.log('ticket_auth: subscribed', found)
        if (!found) {
          cb(new Error('authentication_failed'))
        }
        api.unsubscribe(subId)
      })
    })
  }

  wampcra_extra(_realmName: string, _secureDetails: any, cb: (err?: Error, challenge?: string) => void): void {
    cb(undefined, 'some-random-string')
  }

  wampcra_auth(realmName: string, secureDetails: any, secret: string, extra: any): void {
    console.log(realmName, secureDetails, secret, extra)
  }

  authorize(session: Session, funcClass: string, uniUri: string[]): boolean {
    const userDetails = session.getUserDetails()
    console.log('authorize:', funcClass, uniUri, 'userDetails:', userDetails)
    if (userDetails.role === 'admin') {
      return true
    } else {
      return !intersect(uniUri, ['sys', 'user', 'info', '#'])
    }
  }
}

app.getRealm('realm1', async (realm: BaseRealm) => {
  const api = realm.wampApi()
  await api.publish('sys.user.info.joe', [{ role: 'user', password: 'joe-secret' }], null, { retain: true })
  await api.publish('sys.user.info.admin', [{ role: 'admin', password: 'admin-secret' }], null, { retain: true })
})

console.log('Listening port:', program.port)
app.listenWAMP({ port: program.port }, new WampAuth())
