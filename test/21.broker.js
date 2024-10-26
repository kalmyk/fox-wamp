'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const promised    = require('chai-as-promised')

const { RESULT_OK, RESULT_ACK, RESULT_ERR } = require('../lib/messages')
const { errorCodes } = require('../lib/realm_error')
const { FoxGate }    = require('../lib/hyper/gate')
const Router         = require('../lib/router')
const { BaseRealm, BaseEngine } = require('../lib/realm')
const { MemEngine }  = require('../lib/mono/memengine')

chai.use(promised)
chai.use(spies)

const runs = [
  {it: 'zero', mkEngine: () => new BaseEngine()},
  {it: 'mem',  mkEngine: () => new MemEngine()},
]

describe('21 hyper-broker', () => {
  runs.forEach(function (run) {
    describe('binder:' + run.it, function () {
      let
        socketHistory,
        router,
        gate,
        socketMock,
        realm,
        ctx,
        session
  
      beforeEach(() => {
        socketHistory = []
        socketMock = { hyperPkgWrite: chai.spy((msg) => socketHistory.push(msg)) }
        router = new Router()
        realm = new BaseRealm(router, run.mkEngine())
        router.addRealm('test-realm', realm)

        gate = new FoxGate(router)
        session = router.createSession()
        ctx = gate.createContext(session, socketMock)
        realm.joinSession(session)
      })
    
      afterEach(() => {
        if (session) {
          session.cleanup()
          session = null
        }
        socketHistory = null
      })
  
      it('echo should return OK with sent data', () => {
        const id = 11

        gate.handle(ctx, session, {
          ft: 'ECHO',
          id: id,
          data: { body: 'data package' }
        })
        expect(socketMock.hyperPkgWrite).to.have.been.called.once()

        expect(socketHistory.shift()).to.deep.equal({
          rsp: RESULT_OK,
          id: id,
          data: { body: 'data package' }
        })
      })

      it('error to unknown task-yield', () => {
        gate.handle(ctx, session, {
          ft: 'YIELD',
          rsp: RESULT_OK,
          qid: 1234,
          data: { body: 'data package' }
        })
        expect(socketMock.hyperPkgWrite).to.have.been.called.once()

        expect(socketHistory.shift()).to.deep.equal({
          rsp: RESULT_ERR,
          ft: 'YIELD',
          id: 1234,
          data: {
            code: 103,
            message: 'The defer requested not found'
          }
        })
      })
    
      it('call returns error if there is no registration', () => {
        const id = 12
    
        gate.handle(ctx, session, {
          ft: 'CALL',
          uri: ['testQ'],
          id: id
        })
        expect(socketMock.hyperPkgWrite).to.have.been.called.once()

        expect(socketHistory.shift()).to.deep.equal({
          rsp: RESULT_ERR,
          ft: 'CALL',
          id: id,
          data: {
            code: errorCodes.ERROR_NO_SUCH_PROCEDURE,
            message: 'no callee registered for procedure <testQ>'
          }
        })
      })
    
      it('subscribe-unsubscribed', function () {
        const idSub = 11
        const idUnSub = 12
        let regSub = {}
    
        socketMock.hyperPkgWrite = chai.spy((msg) => {
          if (msg.id === idSub) {
            expect(msg.id).to.equal(idSub)
            expect(msg.rsp).to.equal(RESULT_ACK)
            regSub = msg.qid
          } else {
            expect(msg).to.deep.equal({
              rsp: RESULT_OK,
              id: idUnSub
            })
          }
        })
        gate.handle(ctx, session, {
          ft: 'REG',
          uri: ['testQ'],
          id: idSub,
          opt: {}
        })

        gate.handle(ctx, session, {
          ft: 'UNREG',
          unr: regSub,
          id: idUnSub
        })

        expect(socketMock.hyperPkgWrite).to.have.been.called.twice()
      })

      it('should-unTrace', function () {
        const idTrace = 11
        const idUnTrace = 12

        gate.handle(ctx, session, {
          ft: 'TRACE',
          uri: ['testQ'],
          id: idTrace,
          opt: {}
        })
        let msg = socketHistory.shift()
        expect(msg.rsp).to.equal(RESULT_ACK)
        expect(msg.id).to.equal(idTrace)
        let regTrace = msg.qid

        gate.handle(ctx, session, {
          ft: 'UNTRACE',
          unr: regTrace,
          id: idUnTrace
        })
        expect(socketHistory.shift()).to.deep.equal({
          rsp: RESULT_OK,
          id: idTrace,
          qid: regTrace
        })
        expect(socketHistory.shift()).to.deep.equal({
          rsp: RESULT_OK,
          id: idUnTrace
        })
        expect(socketMock.hyperPkgWrite).to.have.been.called.exactly(3)
      })

      it('no-storage-error:' + run.it, async function () {
        gate.handle(ctx, session, {
          ft: 'PUSH',
          uri: ['testQ'],
          opt: { retain: true },
          id: 123
        })

        expect(socketMock.hyperPkgWrite).to.have.been.called.once()

        expect(socketHistory.shift()).to.deep.equal({
          id: 123,
          ft: 'PUSH',
          rsp: 'ERR',
          data: { code: 'no_storage_defined', message: 'no_storage_defined' }
        })
      })

    })
  })
})
