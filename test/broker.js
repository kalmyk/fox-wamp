'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const assert      = chai.assert
const promised    = require('chai-as-promised')

const { RESULT_OK, RESULT_ACK, RESULT_ERR } = require('../lib/messages')
const errorCodes  = require('../lib/realm_error').errorCodes
const FoxGate     = require('../lib/hyper/gate')
const Router      = require('../lib/router')

chai.use(promised)
chai.use(spies)

describe('hyper-broker', function () {
  let
    router,
    gate,
    sender,
    realm,
    ctx,
    session

  beforeEach(function () {
    sender = {}
    router = new Router()
    realm = router.createRealm('test-realm')
    gate = new FoxGate(router)
    session = gate.createSession()
    ctx = gate.createContext(session, sender)
    realm.joinSession(session)
  })

  afterEach(function () {
    if (session) {
      session.cleanup()
      session = null
    }
  })

  it('echo should return OK with sent data', function () {
    const id = 11
    sender.send = chai.spy((msg) => {
      expect(msg).to.deep.equal({
        rsp: RESULT_OK,
        id: id,
        data: { body: 'data package' }
      })
    })

    session.handle(ctx, {
      ft: 'ECHO',
      id: id,
      data: { body: 'data package' }
    })
    expect(sender.send).to.have.been.called.once()
  })

  it('error to unknown task-yield', function () {
    sender.send = chai.spy((msg) => {
      expect(msg).to.deep.equal({
        rsp: RESULT_ERR,
        ft: 'YIELD',
        id: 1234,
        data: {
          code: 103,
          message: 'The defer requested not found'
        }
      })
    })

    session.handle(ctx, {
      ft: 'YIELD',
      rsp: RESULT_OK,
      qid: 1234,
      data: { body: 'data package' }
    })
    expect(sender.send).to.have.been.called.once()
  })

  it('call should return error with no subscribers', function () {
    const id = 12
    sender.send = chai.spy((msg) => {
      expect(msg).to.deep.equal({
        rsp: RESULT_ERR,
        ft: 'CALL',
        id: id,
        data: {
          code: errorCodes.ERROR_NO_SUCH_PROCEDURE,
          message: 'no callee registered for procedure <testQ>'
        }
      })
    })

    session.handle(ctx, {
      ft: 'CALL',
      uri: ['testQ'],
      id: id
    })
    expect(sender.send).to.have.been.called.once()
  })

  it('subscribe-unsubscribed', function () {
    const idSub = 11
    const idUnSub = 12
    let regSub = {}

    sender.send = chai.spy((msg) => {
      if (msg.id === idSub) {
        expect(msg.id).to.equal(idSub)
        expect(msg.rsp).to.equal(RESULT_ACK)
        regSub = msg.data
      } else {
        expect(msg).to.deep.equal({
          rsp: RESULT_OK,
          id: idUnSub
        })
      }
    })
    session.handle(ctx, {
      ft: 'REG',
      uri: ['testQ'],
      id: idSub,
      opt: {}
    })

    session.handle(ctx, {
      ft: 'UNREG',
      unr: regSub,
      id: idUnSub
    })
    expect(sender.send).to.have.been.called.twice()
  })

  it('should-unTrace', function () {
    const idTrace = 11
    const idUnTrace = 12
    let regTrace

    sender.send = chai.spy((msg) => {
      if (msg.id === idTrace) {
        expect(msg.rsp).to.equal(RESULT_ACK)
        expect(msg.id).to.equal(idTrace)
        regTrace = msg.data
      } else {
        expect(msg).to.deep.equal({
          rsp: RESULT_OK,
          id: idUnTrace
        })
      }
    })
    session.handle(ctx, {
      ft: 'TRACE',
      uri: ['testQ'],
      id: idTrace
    })

    session.handle(ctx, {
      ft: 'UNTRACE',
      unr: regTrace,
      id: idUnTrace
    })
    expect(sender.send).to.have.been.called.twice()
  })

  it('push-will', function () {
    const api = realm.foxApi()

    let n = 0
    const event = chai.spy((id, event) => {
      n++
      if (n === 1) {
        expect(event).to.deep.equal({ kv: { event: 'value' } })
      }
      if (n === 2) {
        expect(event).to.deep.equal({ kv: { will: 'value' } })
      }
    })
    api.subscribe(['will', 'test'], event)

    session.handle(ctx, {
      ft: 'PUSH',
      data: { kv: { event: 'value' } },
      uri: ['will', 'test'],
      opt: { retain: true, will: { kv: { will: 'value' } } }
    })
    expect(event).to.have.been.called.once()

    session.cleanup()
    expect(event).to.have.been.called.twice()
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
    const event = chai.spy((id, event) => {
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
