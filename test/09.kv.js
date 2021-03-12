'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const assert      = chai.assert
const promised    = require('chai-as-promised')

const FoxGate      = require('../lib/hyper/gate')
const Router       = require('../lib/router')
const {MemBinder}  = require('../lib/mono/membinder')

chai.use(promised)
chai.use(spies)

describe('09. hyper-kv', function () {
  let
    router,
    gate,
    sender,
    realm,
    ctx,
    session

  beforeEach(function () {
    sender = {}
    router = new Router(new MemBinder())
    realm = router.createRealm('test-realm')
    gate = new FoxGate(router)
    session = gate.createSession()
    ctx = gate.createContext(session, sender)
    realm.joinSession(session)
  })

  afterEach(function () {
    if (session) {
      gate.removeSession(session)
      session = null
    }
  })

  it('push-watch-for-push', function () {
    let n = 0
    sender.send = chai.spy((msg) => {
      n++
      if (n === 1) {
        expect(msg).to.deep.equal({ id: 'init-kv', rsp: 'OK', data: undefined })
      } else if (n === 2) {
        expect(msg).to.deep.equal({ id: 'watch-for-value', rsp: 'OK', data: undefined })
      }
    })

    const api = realm.foxApi()

    let m = 0
    const event = chai.spy((event, opt) => {
      m++
      if (m === 1) {
        expect(event).to.deep.equal({ kv: { event: 'value' } })
      } else if (m === 2) {
        expect(event).to.deep.equal({ kv: { event: 'watch-for-empty' } })
      }
    })
    api.subscribe(['watch', 'test'], event)

    session.handle(ctx, {
      ft: 'PUSH',
      data: { kv: { event: 'value' } },
      uri: ['watch', 'test'],
      opt: {
        retain: true,
        trace: true
      },
      ack: true,
      id: 'init-kv'
    })
    expect(event).to.have.been.called.once()
    expect(sender.send).to.have.been.called.once()
    expect(realm.engine._messages.length).to.equal(1)

    session.handle(ctx, {
      ft: 'PUSH',
      data: { kv: { event: 'watch-for-empty' } },
      uri: ['watch', 'test'],
      opt: {
        trace: true,
        retain: true,
        when: null,
        watch: true
      },
      ack: true,
      id: 'watch-for-value'
    })
    expect(event).to.have.been.called.once()
    expect(sender.send).to.have.been.called.once()
    expect(realm.engine._messages.length).to.equal(1)

    api.publish(['watch', 'test'], null, { retain: true })
    expect(event).to.have.been.called.twice()
    expect(sender.send).to.have.been.called.twice()
    expect(realm.engine._messages.length).to.equal(2)
  })

  it('push-watch-for-will', function () {
    let defer = []
    sender.send = chai.spy((msg) => {})

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
    api.subscribe('watch.test', event)

    session.handle(ctx, {
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
