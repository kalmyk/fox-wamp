'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const { RESULT_OK, RESULT_ACK, RESULT_ERR } = require('../lib/messages')
const { errorCodes } = require('../lib/realm_error')
const FoxGate      = require('../lib/hyper/gate')
const Router       = require('../lib/router')
const { BaseRealm, BaseEngine } = require('../lib/realm')
const { MemEngine } = require('../lib/mono/memengine')

chai.use(promised)
chai.use(spies)

const runs = [
  {it: 'zero', mkEngine: () => new BaseEngine()},
  {it: 'mem',  mkEngine: () => new MemEngine()},
]

describe('21 hyper-broker', function () {
  runs.forEach(function (run) {
    describe('binder:' + run.it, function () {
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
        realm = new BaseRealm(router, run.mkEngine())
        router.addRealm('test-realm', realm)

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
          id: idTrace,
          opt: {}
        })

        session.handle(ctx, {
          ft: 'UNTRACE',
          unr: regTrace,
          id: idUnTrace
        })
        expect(sender.send).to.have.been.called.twice()
      })

      it('no-storage-error:' + run.it, async function () {
        sender.send = chai.spy((msg) => {
          expect(msg).to.deep.equal({
            id: 123,
            ft: 'PUSH',
            rsp: 'ERR',
            data: { code: 'no_storage_defined', message: 'no_storage_defined' }
          })
        })

        session.handle(ctx, {
          ft: 'PUSH',
          uri: ['testQ'],
          opt: { retain: true },
          id: 123
        })

        expect(sender.send).to.have.been.called.once()
      })

    })
  })
})
