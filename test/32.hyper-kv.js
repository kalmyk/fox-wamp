'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const assert      = chai.assert
const promised    = require('chai-as-promised')

const FoxGate      = require('../lib/hyper/gate')
const FoxRouter    = require('../lib/fox_router')

chai.use(promised)
chai.use(spies)

describe('32 hyper-kv', function () {
  let
    router,
    gate,
    sessionSender,
    realm,
    ctx,
    session

  beforeEach(function () {
    router = new FoxRouter()
    realm = router.getRealm('test-realm')
    gate = new FoxGate(router)
    session = router.createSession()
    sessionSender = {}
    ctx = gate.createContext(session, sessionSender)
    realm.joinSession(session)
  })

  afterEach(function () {
    if (session) {
      gate.getRouter().removeSession(session)
      session = null
    }
  })

  it('push-watch-for-will', async () => {
    let defer = []
    sessionSender.send = chai.spy((msg) => {})

    const api = realm.wampApi()

    let m = 0
    const event = chai.spy((id, args, kwargs) => {
      m++
      if (m === 1) {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal({ event: 'value-1' })        
      } else if (m === 2) {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal(undefined)
      } else if (m === 3) {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal({ event: 'value-2' })
      } else {
        expect(true).to.equal('no more events')
      }
    })
    await api.subscribe('watch.test', event)

    gate.handle(ctx, session, {
      ft: 'PUSH',
      data: { kv: { event: 'value-1' } },
      uri: ['watch', 'test'],
      opt: {
        retain: true,
        trace: true,
        when: null,
        will: null
      },
      ack: true,
      id: 'init-kv'
    })

    defer.push(assert.isRejected(
      api.publish(
        'watch.test',
        [],
        { event: 'value-no-watch' },
        {
          retain: true,
          trace: true,
          when: null,
          will: null,
          acknowledge: true
        }
      )
    ))

    defer.push(assert.becomes(
      api.publish(
        'watch.test',
        [],
        { event: 'value-2' },
        {
          retain: true,
          trace: true,
          when: null,
          will: null,
          watch: true,
          acknowledge: true,
          exclude_me: false
        }
      ).then(() => {
        expect(session, 'after disconnect').to.equal(null)
        return 'LOCK-DONE'
      }),
      'LOCK-DONE'
    ))

    session.cleanup()
    session = null

    return Promise.all(defer).then(() => {
      expect(event).to.have.been.called.exactly(3)
    })
  })
})
