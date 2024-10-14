'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect
const assert = chai.assert
const promised    = require('chai-as-promised')

const { deepDataMerge } = require('../lib/realm')
const WAMP     = require('../lib/wamp/protocol')
const WampGate = require('../lib/wamp/gate')
const FoxRouter = require('../lib/fox_router')
const MemKeyValueStorage = require('../lib/mono/memkv').MemKeyValueStorage

chai.use(promised)
chai.use(spies)

describe('20 wamp-realm', () => {
  let
    router,
    gate,
    realm,
    mockSocket,
    ctx,
    cli,
    api,
    apx

  beforeEach(function () {
    router = new FoxRouter()
    realm = router.getRealm('test-realm')
    api = realm.wampApi()
    apx = realm.api()

    mockSocket = {}
    gate = new WampGate(router)
    cli = router.createSession()
    ctx = gate.createContext(cli, mockSocket)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  it('empty cleanup', function () {
    realm.leaveSession(cli)
    realm.leaveSession(api)
    realm.leaveSession(apx.session())
  })

  it('session-list', function () {
    let result = realm.getSessionIds()
    expect(result).to.be.an('array').that.is.not.empty
  })

  it('deepDataMerge', function () {
    let result
    result = deepDataMerge(
      { args:[], kwargs:{key1: "v1", key2: {key3: "v3"}} },
      { payload: Buffer.from('{"key1":"v1-update","key2":{"key5":"v5"}}') }
    )
    expect(result).to.deep.equal({ kv: { key1: 'v1-update', key2: { key3: 'v3', key5: 'v5' } } })

    result = deepDataMerge(
      { args:[], kwargs:{key1: "v1", key2: {key3: "v3"}} },
      { payload: Buffer.from('{"json-error":<package>') }
    )
    expect(result).to.deep.equal({ args:[], kwargs:{key1: "v1", key2: {key3: "v3"}} })
  })

  describe('RPC', function () {
    it('CALL to RPC not exist', function () {
      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expect(msg[0]).to.equal(WAMP.ERROR)
        expect(msg[1]).to.equal(WAMP.CALL)
        expect(msg[2]).to.equal(1234)
        expect(msg[4]).to.equal('wamp.error.no_such_procedure')
        expect(msg[5]).to.deep.equal(['no callee registered for procedure <any.function.name>'])
      })
      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'any.function.name', []])
      expect(mockSocket.wampPkgWrite).to.have.been.called.once()
    })

    it('cleanup RPC API', function () {
      apx.session().cleanupReg(realm.engine)  // clean existing wamp/session/? functions
      var procSpy = chai.spy(function () {})
      apx.register('func1', procSpy)
      expect(apx.session().cleanupReg(realm.engine)).to.equal(1)
      expect(apx.session().cleanupReg(realm.engine)).to.equal(0)
      expect(procSpy).to.not.have.been.called()
    })

    it('CALL-to-router', async () => {
      let procSpy = chai.spy(function (id, args, kwargs) {
        api.resrpc(id, undefined, ['result.1', 'result.2'], { kVal: 'kRes' })
      })
      let regId = await api.register('func1', procSpy)

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expect(msg[0]).to.equal(WAMP.RESULT)
        expect(msg[1]).to.equal(1234)
        expect(msg[3]).to.deep.equal(['result.1', 'result.2'])
        expect(msg[4]).to.deep.equal({ kVal: 'kRes' })
      })
      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], { kArg: 'kVal' }])
      expect(procSpy, 'RPC delivered').to.have.been.called.once()
      expect(mockSocket.wampPkgWrite, 'result delivered').to.have.been.called.once()
      expect(api.unregister(regId)).to.equal('func1')
    })

    it('CALL to router with error', function () {
      var callId = null
      var procSpy = chai.spy(function (id, args, kwargs) {
        callId = id
      })
      api.register('func1', procSpy)
      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.CALL)
          expect(msg[2]).to.equal(1234)
          expect(msg[4]).to.deep.equal('wamp.error.callee_failure')
        }
      )
      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], { kArg: 'kVal' }])
      api.resrpc(callId, 1, ['result.1', 'result.2'], { kVal: 'kRes' })
      expect(procSpy).to.have.been.called.once()
      expect(mockSocket.wampPkgWrite).to.have.been.called.once()
    })

    it('UNREGISTER error', function () {
      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.UNREGISTER)
          expect(msg[2]).to.equal(2345)
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_registration')
        }
      )
      gate.handle(ctx, cli, [WAMP.UNREGISTER, 2345, 1234567890])
      expect(mockSocket.wampPkgWrite, 'unregistration confirmed').to.have.been.called.once()
    })

    it('UNREGISTER', function () {
      var qid = null

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.REGISTERED)
          expect(msg[1]).to.equal(1234)
          qid = msg[2]
        }
      )
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
      expect(mockSocket.wampPkgWrite, 'registration confirmed').to.have.been.called.once()

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.UNREGISTERED)
          expect(msg[1]).to.equal(2345)
        }
      )
      gate.handle(ctx, cli, [WAMP.UNREGISTER, 2345, qid])
      expect(mockSocket.wampPkgWrite, 'unregistration confirmed').to.have.been.called.once()
    })

    it('CALL-to-remote', async () => {
      let qid = null
      let expectedResult = []

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expectedResult.push([msg[0],msg[1]])
        qid = msg[2]
      })
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
      expect(mockSocket.wampPkgWrite, 'registration confirmed').to.have.been.called.once()
      assert.deepEqual(expectedResult.shift(), [WAMP.REGISTERED, 1234])

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expectedResult.push([msg[0],msg[2],msg[3],msg[4],msg[5]])
        let callId = msg[1]
        // return the function result
        gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result.1', 'result.2'], { foo: 'bar' }])
      })

      const callResult = await apx.callrpc('func1', { kv: { v1: 'kRes' }})
      const invocationRequest = expectedResult.shift()
      assert.deepEqual(invocationRequest, [WAMP.INVOCATION, qid, {}, [], { v1: 'kRes' }])

      expect(callResult).to.deep.equal({
        args: ['result.1', 'result.2'],
        kwargs: { foo: 'bar' }
      }, 'response')

      expect(mockSocket.wampPkgWrite, 'invocation received').to.have.been.called.once()
    })

    it('CALL error to remote', async () => {
      mockSocket.wampPkgWrite = () => {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        let callId = msg[1]
        gate.handle(ctx, cli, [WAMP.ERROR, WAMP.INVOCATION, callId, {}, 'test-error-text', ['err.detail.1', 'err.detail.2']])
      })

      let result = await apx.callrpc('func1', ['arg.1']).then(() => 'resolve-not-accepted', (reason) => reason)

      expect(result).to.deep.equal({error:{code:'error.callee_failure', message:'test-error-text'}})
      expect(mockSocket.wampPkgWrite, 'invocation received').to.have.been.called.once()
    })

    it('CALL-set-concurrency', function () {
      mockSocket.wampPkgWrite = function () {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, { concurrency: 2 }, 'func1'])

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {})
      apx.callrpc('func1', [], {})
      apx.callrpc('func1', [], {})
      apx.callrpc('func1', [], {})

      expect(mockSocket.wampPkgWrite).to.have.been.called.twice()
    })

    it('CALL-concurrency-unlimited', function () {
      mockSocket.wampPkgWrite = function () {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {})
      apx.callrpc('func1', [], {})
      apx.callrpc('func1', [], {})
      apx.callrpc('func1', [], {})

      expect(mockSocket.wampPkgWrite).to.have.been.called.exactly(3)
    })

    it('progress-remote-CALL', async () => {
      mockSocket.wampPkgWrite = () => {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])

      let callId = null
      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expect(msg[0]).to.equal(WAMP.INVOCATION)
        callId = msg[1]
        // qid
        expect(msg[3]).to.deep.equal({ receive_progress: true })

        gate.handle(ctx, cli, [WAMP.YIELD, callId, { progress: true }, ['result.1'], {kv:1}])
        gate.handle(ctx, cli, [WAMP.YIELD, callId, { progress: true }, ['result.2'], {kv:2}])
        gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result.3.final'], {kv:3}])
      })
      let progressResult = []
      let callResponse = (args, kwargs) => {
        progressResult.push([args, kwargs])
      }
      let finalResult = await api.callrpc('func1', [], {}, callResponse, { receive_progress: 1 })
      expect(mockSocket.wampPkgWrite, 'invocation received').to.have.been.called.once()

      expect(progressResult).to.deep.equal([
        [['result.1'], {kv:1}],
        [['result.2'], {kv:2}]
      ])
      expect(finalResult).to.deep.equal({args:['result.3.final'], kwargs: { kv: 3 }})

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expect(msg[0]).to.equal(WAMP.ERROR)
      })
      gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result.response.error']])
      expect(mockSocket.wampPkgWrite).to.have.been.called.once()
    })
  })

  describe('PUBLISH', function () {
    it('UNSUBSCRIBE-ERROR', function () {
      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.UNSUBSCRIBE)
          expect(msg[2]).to.equal(2345)
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_subscription')
        }
      )
      gate.handle(ctx, cli, [WAMP.UNSUBSCRIBE, 2345, 1234567890])
      expect(mockSocket.wampPkgWrite, 'unsubscription confirmed').to.have.been.called.once()
    })

    it('UNSUBSCRIBE-OK', function () {
      var subscriptionId = null

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
          expect(msg[1]).to.equal(1234)
          subscriptionId = msg[2]
        }
      )
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      expect(mockSocket.wampPkgWrite, 'subscription confirmed').to.have.been.called.once()

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.UNSUBSCRIBED)
          expect(msg[1]).to.equal(2345)
        }
      )
      gate.handle(ctx, cli, [WAMP.UNSUBSCRIBE, 2345, subscriptionId])
      expect(mockSocket.wampPkgWrite, 'unsubscription confirmed').to.have.been.called.once()
    })

    it('cleanup Topic API', function () {
      var subSpy = chai.spy(function () {})
      apx.subscribe('topic1', subSpy)
      expect(apx.session().cleanupTrace(realm.engine)).to.equal(1)
      expect(apx.session().cleanupTrace(realm.engine)).to.equal(0)
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH default exclude_me:true', function () {
      var subSpy = chai.spy(function () {})
      apx.subscribe('topic1', subSpy)
      apx.publish('topic1', [], {})
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH exclude_me:false', async () => {
      var subSpy = chai.spy(function () {})
      await apx.subscribe('topic1', subSpy)
      await apx.publish('topic1', {}, { exclude_me: false })
      expect(subSpy).to.have.been.called.once()
    })

    it('PUBLISH-to-pattern', function () {
      var subSpy = chai.spy(function (a, b, c, d) {
        // console.log('Publish Event', a,b,c,d)
      })
      apx.subscribe('topic1.*.item', subSpy)
      apx.publish('topic1.123.item', {}, { exclude_me: false })
      expect(subSpy).to.have.been.called.once()
    })

    it('PUBLISH-to-remote', function () {
      var subscriptionId = null

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
          expect(msg[1]).to.equal(1234)
          subscriptionId = msg[2]
        }
      )
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      expect(mockSocket.wampPkgWrite, 'subscription confirmed').to.have.been.called.once()

      mockSocket.wampPkgWrite = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.EVENT)
          expect(msg[1]).to.equal(subscriptionId)
          // 2 published message Id
          expect(msg[3].topic).to.equal('topic1')
          expect(msg[3].publisher).to.equal(api.getSid())
          expect(msg[4]).to.deep.equal(['arg.1', 'arg.2'])
          expect(msg[5]).to.deep.equal({ foo: 'bar' })
        }
      )
      apx.publish('topic1', ['arg.1', 'arg.2'], { foo: 'bar' })
      expect(mockSocket.wampPkgWrite, 'publication received').to.have.been.called.once()
    })

    it('SUBSCRIBE-to-remote-wamp', async () => {
      let waitForEvent
      let subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal(['arg.1', 'arg.2'])
          expect(kwargs).to.deep.equal({ foo: 'bar' })
          waitForEvent()
          waitForEvent = undefined
        }
      )
      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        expect(msg[0]).to.equal(WAMP.PUBLISHED)
        expect(msg[1]).to.equal(2345)
      })

      let subId = await api.subscribe('topic1', subSpy)

      await new Promise((resolve, reject) => {
        waitForEvent = resolve
        gate.handle(ctx, cli, [WAMP.PUBLISH, 1234, {}, 'topic1', ['arg.1', 'arg.2'], { foo: 'bar' }])
      })
      expect(mockSocket.wampPkgWrite, 'ack is not requested').to.not.have.been.called()

      await new Promise((resolve, reject) => {
        waitForEvent = resolve
        gate.handle(ctx, cli, [WAMP.PUBLISH, 2345, { acknowledge: true }, 'topic1', ['arg.1', 'arg.2'], { foo: 'bar' }])
      })
      expect(mockSocket.wampPkgWrite, 'ack must be received').to.have.been.called.once()

      expect(subSpy, 'publication done').to.have.been.called.twice()
      expect(api.unsubscribe(subId)).to.equal('topic1')
    })

    it('omit-tasks-of-terminated-sessions', async () => {
      let uFunc = chai.spy((id, args, kwargs, opt) => {setImmediate(() => {
        cli.cleanup().then(() => {
          api.resrpc(id, null, ['any-result'])
        })
      })})
      await api.register('func1', uFunc)

      mockSocket.wampPkgWrite = chai.spy()
      gate.handle(ctx, cli, [WAMP.CALL, 1231, {}, 'func1', ['call-1']])
      gate.handle(ctx, cli, [WAMP.CALL, 1232, {}, 'func1', ['call-2']])
      gate.handle(ctx, cli, [WAMP.CALL, 1233, {}, 'func1', ['call-3']])

      await api.callrpc('func1', ['call-4'])
      expect(uFunc).to.have.been.called.twice()
      expect(mockSocket.wampPkgWrite).to.have.been.called.once()
    })
  
  })

  describe('STORAGE', function () {

    it('reduce-one', function () {
      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        // console.log('REDUCE-CALL', msg);
      })

      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, { reducer: true }, 'storage'])
      apx.publish('storage', { data: 'init-value', count: 1 }, { retain: true })
      apx.publish('storage', { data: 'value-to-reduce', count: 2 }, { retain: true })

      expect(mockSocket.wampPkgWrite).to.have.been.called.exactly(3)
    })

    it('custom-key-value', function () {
      const app = new MemKeyValueStorage()
      realm.registerKeyValueEngine(['cache', '*', 'name', '#'], app)

      apx.publish('cache.user.name.john', { fullName: 'John Doe' }, { retain: true })

      const row = chai.spy((aKey, data) => {
        expect(aKey).to.deep.equal(['user', 'john'])
        expect(data).to.deep.equal({ args: [], kwargs: { fullName: 'John Doe' } })
      })
      app.getKey(['*', 'john'], row)
      expect(row, 'data has to be saved').to.have.been.called.exactly(1)

      mockSocket.wampPkgWrite = chai.spy((msg, callback) => {
        if (msg[1] === WAMP.EVENT) {
          expect(msg[3]).to.deep.equal({ topic: 'cache.user.name.john', retained: true })
          expect(msg[4]).to.deep.equal([])
          expect(msg[5]).to.deep.equal({ fullName: 'John Doe' })
        }
      })
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'cache.*.name.#'])
      expect(mockSocket.wampPkgWrite).to.have.been.called.exactly(2)
    })
  })
})
