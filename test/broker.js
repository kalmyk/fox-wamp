'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const { RESULT_OK, RESULT_ACK, RESULT_ERR } = require('../lib/messages')
const errorCodes  = require('../lib/realm_error').errorCodes
const FoxGate     = require('../lib/hyper/gate')
const Realm       = require('../lib/realm').Realm
const Router      = require('../lib/router')

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
    realm = new Realm(router)
    gate = new FoxGate(router)
    ctx = router.createContext()
    session = router.createSession(gate, sender)
    realm.joinSession(session)
  })

  afterEach(function () {
    session.cleanup()
    session = null
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

  it('published-confirm', function () {
    const idTrace = 20
    const idUnTrace = 21
    const idPush = 22
    let regTrace
    let regPush

    // make realm replicable
    realm.engine.actorConfirm = (actor, cmd) => {};

    realm.engine.doConfirm = (actor, cmd) => {
      actor.confirm(cmd)
    }

    sender.send = chai.spy((msg) => {
      regTrace = msg.data
      expect(msg).to.deep.equal({
        id: idTrace,
        rsp: RESULT_ACK,
        data: regTrace
      })
    })

    session.handle(ctx, {
      ft: 'TRACE',
      uri: ['testQ'],
      id: idTrace
    })
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy((msg) => {
      regPush = msg.qid
      expect(msg).to.deep.equal({
        id: idTrace,
        uri: ['testQ'],
        qid: regPush,
        opt: {},
        rsp: 'EVENT',
        data: 'published-data'
      })
    })

    session.handle(ctx, {
      ft: 'PUSH',
      uri: ['testQ'],
      ack: true,
      data: 'published-data',
      id: idPush
    })
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy((msg) => {
      expect(msg).to.deep.equal({
        id: idPush,
        qid: regPush,
        rsp: RESULT_OK,
        data: 'confirm-data'
      })
    })

    session.handle(ctx, {
      ft: 'CONFIRM',
      qid: regPush,
      data: 'confirm-data'
    })
    expect(sender.send).to.have.been.called.once()

    sender.send = chai.spy((msg) => {
      expect(msg).to.deep.equal({
        id: idUnTrace,
        rsp: RESULT_OK
      })
    })

    session.handle(ctx, {
      ft: 'UNTRACE',
      unr: regTrace,
      id: idUnTrace
    })
    expect(sender.send).to.have.been.called.once()
  })
})
