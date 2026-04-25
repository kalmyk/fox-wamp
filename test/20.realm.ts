import * as chai from 'chai';
const { expect } = chai;
const assert: Chai.AssertStatic = chai.assert;
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import { isDataEmpty, deepDataMerge, BaseRealm } from '../lib/realm.js'
import WAMP     from '../lib/wamp/protocol.js'
import { WampGate, WampSocketWriterContext } from '../lib/wamp/gate.js'
import FoxRouter from '../lib/fox_router.js'
import { MemKeyValueStorage } from '../lib/mono/memkv.js'
import Session from '../lib/session.js'
import WampApi from '../lib/wamp/api.js'

describe('20.wamp-realm', async () => {
  let
    socketHistory: any[],
    router: FoxRouter,
    gate: WampGate,
    realm: BaseRealm,
    mockSocket: any,
    ctx: WampSocketWriterContext,
    cli: Session,
    api: WampApi

  beforeEach(async () => {
    router = new FoxRouter()
    realm = await router.getRealm('test_realm')
    api = realm.wampApi()

    socketHistory = []
    mockSocket = { wampPkgWrite: chai.spy(((msg: any, callback: any) => socketHistory.push(msg))) }
    gate = new WampGate(router)
    cli = router.createSession()
    ctx = gate.createContext(cli, mockSocket)
    realm.joinSession(cli)
  })

  afterEach(async () => {
    assert.isFalse(api.hasSendError(), api.firstSendErrorMessage())
    assert.isFalse(cli.hasSendError(), cli.firstSendErrorMessage())
  })

  it('empty cleanup', async () => {
    realm.leaveSession(cli)
    realm.leaveSession(api)
  })

  it('session-list', async () => {
    let result = realm.getSessionIds()
    expect(result).to.be.an('array').that.is.not.empty
  })

  it('isDataEmpty', () => {
    assert.isTrue(isDataEmpty(null))
    assert.isTrue(isDataEmpty({args:[]}))
    assert.isTrue(isDataEmpty({args:[null]}))
    assert.isTrue(isDataEmpty({kv:null}))
    assert.isFalse(isDataEmpty({args:[1]}))
  })

  it('deepDataMerge', () => {
    let result
    result = deepDataMerge(
      { args:[{key1: "v1", key2: {key3: "v3"}}] },
      { payload: Buffer.from('{"key1":"v1-update","key2":{"key5":"v5"}}') }
    )
    expect(result).to.deep.equal({ kv: { key1: 'v1-update', key2: { key3: 'v3', key5: 'v5' } } })

    result = deepDataMerge(
      { args:[{key1: "v1", key2: {key3: "v3"}}] },
      { payload: Buffer.from('{"json-error":<package>') }
    )
    expect(result).to.deep.equal({ args:[{key1: "v1", key2: {key3: "v3"}}] })
  })

  describe('RPC', async () => {
    it('CALL to RPC not exist', async () => {
      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'any.function.name', []])
      expect(mockSocket.wampPkgWrite).called.exactly(1)

      const msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.ERROR)
      expect(msg[1]).to.equal(WAMP.CALL)
      expect(msg[2]).to.equal(1234)
      expect(msg[4]).to.equal('wamp.error.no_such_procedure')
      expect(msg[5]).to.deep.equal(['no callee registered for procedure <any.function.name>'])
    })

    it('cleanup RPC API', async () => {
      api.cleanupReg(realm.engine)  // clean existing wamp/session/? functions
      var procSpy = chai.spy(function () {})
      api.register('func1', procSpy)
      expect(api.cleanupReg(realm.engine)).to.equal(1)
      expect(api.cleanupReg(realm.engine)).to.equal(0)
      expect(procSpy).to.not.have.been.called()
    })

    it('CALL-to-router', async () => {
      let procSpy = chai.spy(function (id: any, args: any, kwargs: any) {
        api.resrpc(id, null, [...args, 'result1'], { kres: kwargs })
      })
      let regId = await api.register('func1', procSpy)

      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1'], { kArg: 'kVal' }])
      expect(procSpy, 'RPC delivered').called.exactly(1)
      expect(mockSocket.wampPkgWrite, 'result delivered').called.exactly(1)
      const msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.RESULT)
      expect(msg[1]).to.equal(1234)
      expect(msg[3]).to.deep.equal(['arg1', 'result1'])
      expect(msg[4]).to.deep.equal({ kres:{ kArg: 'kVal' }})

      const subActor = api.getSub(regId)
      expect(subActor.isAble()).to.equal(true)
      expect(subActor.getTasksRequestedCount()).to.equal(0)
      expect(api.unregister(regId)).to.equal('func1')
    })

    it('CALL to router with error', async () => {
      var procSpy = chai.spy(function (id: any, args: any, kwargs: any) {
        api.resrpc(id, 'error-message', ['result.1', 'result.2'], { kVal: 'kRes' })
      })
      let regId = await api.register('func1', procSpy)
      gate.handle(ctx, cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], { kArg: 'kVal' }])
      expect(procSpy).called.exactly(1)
      expect(mockSocket.wampPkgWrite).called.exactly(1)
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.ERROR)
      expect(msg[1]).to.equal(WAMP.CALL)
      expect(msg[2]).to.equal(1234)
      expect(msg[4]).to.equal('wamp.error.callee_failure')
      expect(msg[5]).to.deep.equal(['error-message'])

      const subActor = api.getSub(regId)
      expect(subActor.isAble()).to.equal(true)
      expect(subActor.getTasksRequestedCount()).to.equal(0)
    })

    it('UNREGISTER error', async () => {
      gate.handle(ctx, cli, [WAMP.UNREGISTER, 2345, 1234567890])
      expect(mockSocket.wampPkgWrite, 'unregistration confirmed').called.exactly(1)

      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.ERROR)
      expect(msg[1]).to.equal(WAMP.UNREGISTER)
      expect(msg[2]).to.equal(2345)
      // 3 options is skipped
      expect(msg[4]).to.equal('wamp.error.no_such_registration')
    })

    it('UNREGISTER', async () => {
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.REGISTERED)
      expect(msg[1]).to.equal(1234)
      let registrationId = msg[2]

      gate.handle(ctx, cli, [WAMP.UNREGISTER, 2345, registrationId])
      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.UNREGISTERED)
      expect(msg[1]).to.equal(2345)

      expect(mockSocket.wampPkgWrite, 'unregistration confirmed').called.exactly(2)
    })

    it('CALL-to-remote', async () => {
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.REGISTERED)
      expect(msg[1]).to.equal(1234)
      let registrationId = msg[2]

      const callPromise = api.callrpc('func1', ['arg1'], { v1: 'kRes' })
      assert.isTrue(callPromise instanceof Promise)

      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.INVOCATION)
      let callId = msg[1]
      expect(msg[2]).to.equal(registrationId)
      expect(msg[3]).to.deep.equal({}) // opt
      expect(msg[4]).to.deep.equal(['arg1']) // args
      expect(msg[5]).to.deep.equal({ v1: 'kRes' }) // kwargs

      // return the function result
      gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result1'], { foo: 'bar' }])

      await assert.becomes(callPromise, {args:['result1'], kwargs:{foo: 'bar'}})
    })

    it('CALL error to remote', async () => {
      mockSocket.wampPkgWrite = () => {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])

      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {
        let callId = msg[1]
        gate.handle(ctx, cli, [WAMP.ERROR, WAMP.INVOCATION, callId, {}, 'test-error-text', ['err.detail.1', 'err.detail.2']])
      })

      let result = await api.callrpc('func1', ['arg.1']).then(() => 'resolve-not-accepted', (reason) => reason)

      expect(result).to.deep.equal({code:'wamp.error.callee_failure', message:'test-error-text'})
      expect(mockSocket.wampPkgWrite, 'invocation received').called.exactly(1)
    })

    it('CALL-set-concurrency', async () => {
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, { concurrency: 2 }, 'func1'])
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.REGISTERED)

      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})

      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.INVOCATION)
      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.INVOCATION)

      expect(mockSocket.wampPkgWrite).called.exactly(3)
    })

    it('CALL-concurrency-unlimited', async () => {
      mockSocket.wampPkgWrite = function () {}
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])

      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})

      expect(mockSocket.wampPkgWrite).called.exactly(3)
    })

    it('progress-remote-CALL', async () => {
      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, {}, 'func1'])
      socketHistory.shift()

      let callId = null
      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {
        expect(msg[0]).to.equal(WAMP.INVOCATION)
        callId = msg[1]
        // qid
        expect(msg[3]).to.deep.equal({ receive_progress: true })

        gate.handle(ctx, cli, [WAMP.YIELD, callId, { progress: true }, ['result.1'], {kv:1}])
        gate.handle(ctx, cli, [WAMP.YIELD, callId, { progress: true }, ['result.2'], {kv:2}])
        gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result.3.final'], {kv:3}])
      })
      let progressResult: any[] = []
      let callResponse = (args: any, kwargs: any) => {
        progressResult.push([args, kwargs])
      }
      let finalResult = await api.callrpc('func1', [], {}, callResponse, { receive_progress: 1 })
      expect(mockSocket.wampPkgWrite, 'invocation received').called.exactly(1)

      expect(progressResult).to.deep.equal([
        [['result.1'], {kv:1}],
        [['result.2'], {kv:2}]
      ])
      expect(finalResult).to.deep.equal({args:['result.3.final'], kwargs: { kv: 3 }})

      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {
        expect(msg[0]).to.equal(WAMP.ERROR)
      })
      gate.handle(ctx, cli, [WAMP.YIELD, callId, {}, ['result.response.error']])
      expect(mockSocket.wampPkgWrite).called.exactly(1)
    })
  })

  describe('PUBLISH', async () => {
    it('UNSUBSCRIBE-ERROR', function () {
      gate.handle(ctx, cli, [WAMP.UNSUBSCRIBE, 2345, 1234567890])
      expect(mockSocket.wampPkgWrite, 'unsubscription confirmed').called.exactly(1)

      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.ERROR)
      expect(msg[1]).to.equal(WAMP.UNSUBSCRIBE)
      expect(msg[2]).to.equal(2345)
      // 3 options
      expect(msg[4]).to.equal('wamp.error.no_such_subscription')
    })

    it('UNSUBSCRIBE-OK', async () => {
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
      expect(msg[1]).to.equal(1234)
      let subscriptionId = msg[2]

      gate.handle(ctx, cli, [WAMP.UNSUBSCRIBE, 2345, subscriptionId])
      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.UNSUBSCRIBED)
      expect(msg[1]).to.equal(2345)
      expect(mockSocket.wampPkgWrite, 'unsubscription confirmed').called.exactly(2)
    })

    it('cleanup Topic API', async () => {
      let subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      expect(api.cleanupTrace(realm.engine)).to.equal(1)
      expect(api.cleanupTrace(realm.engine)).to.equal(0)
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH default exclude_me:true', async () => {
      let subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      api.publish('topic1', [], {})
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH exclude_me:false', async () => {
      let subSpy = chai.spy(() => {})
      await api.subscribe('topic.1', subSpy)
      await api.publish('topic.1', [], {}, { acknowledge: true, exclude_me: false })
      expect(subSpy).called.exactly(1)
    })

    it('PUBLISH NULL', async () => {
      let pubs: any[] = []
      let subSpy = chai.spy((publicationId: any, args: any, kwargs: any, opt: any) => {
        pubs.push([args, kwargs])
      })
      await api.subscribe('topic.1', subSpy)
      gate.handle(ctx, cli, [WAMP.PUBLISH, 1234, {}, 'topic.1', null, null /* undefined args & kwargs */])
      expect(subSpy).called.exactly(1)
      expect(pubs.shift()).to.deep.equal([null,null])
    })

    it('PUBLISH-to-pattern', async () => {
      var subSpy = chai.spy(function (a: any, b: any, c: any, d: any) {
        // console.log('Publish Event', a,b,c,d)
      })
      api.subscribe('topic1.*.item', subSpy)
      api.publish('topic1.123.item', ['arg'], {}, { acknowledge: true, exclude_me: false })
      expect(subSpy).called.exactly(1)
    })

    it('PUBLISH-to-remote', () => {
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
      expect(msg[1]).to.equal(1234)
      let subscriptionId = msg[2]

      api.publish('topic1', ['arg1'], { foo: 'bar' }, {retain: true})
      msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.EVENT)
      expect(msg[1]).to.equal(subscriptionId)
      // 2 published message Id
      expect(msg[3]).to.deep.equal({topic:'topic1', publisher: api.getSid()})
      expect(msg[4]).to.deep.equal(['arg1'])
      expect(msg[5]).to.deep.equal({ foo: 'bar' })

      expect(mockSocket.wampPkgWrite, 'publication received').called.exactly(2)
    })

    it('SUBSCRIBE-to-remote-wamp', async () => {
      const publications: any[] = []
      let subSpy = chai.spy((publicationId: any, args: any, kwargs: any) => {
        publications.push([args, kwargs])
      })
      let subId = await api.subscribe('topic1', subSpy)

      gate.handle(ctx, cli, [WAMP.PUBLISH, 1234, {}, 'topic1', ['arg.11', 'arg.12'], { foo: 'bar1' }])
      expect(socketHistory.length).to.equal(0) // no ack sent

      let pub = publications.shift()
      expect(pub[0] /* args */  ).to.deep.equal(['arg.11', 'arg.12'])
      expect(pub[1] /* kwargs */).to.deep.equal({ foo: 'bar1' })

      expect(mockSocket.wampPkgWrite, 'ack is not requested').to.not.have.been.called()

      gate.handle(ctx, cli, [WAMP.PUBLISH, 2345, { acknowledge: true }, 'topic1', ['arg.21', 'arg.22'], { foo: 'bar2' }])

      expect(mockSocket.wampPkgWrite, 'ack must be received').called.exactly(1)
      let msg = socketHistory.shift()
      expect(msg[0]).to.equal(WAMP.PUBLISHED)
      expect(msg[1]).to.equal(2345)

      pub = publications.shift()
      expect(pub[0] /* args */  ).to.deep.equal(['arg.21', 'arg.22'])
      expect(pub[1] /* kwargs */).to.deep.equal({ foo: 'bar2' })

      expect(subSpy, 'publication done').called.exactly(2)
      expect(api.unsubscribe(subId)).to.equal('topic1')
    })

    it('omit-tasks-of-terminated-sessions', async () => {
      let uFunc = chai.spy((id: any, args: any, kwargs: any, opt: any) => {setImmediate(() => {
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
      expect(uFunc).called.exactly(2)
      expect(mockSocket.wampPkgWrite).called.exactly(1)
    })
  
  })

  describe('STORAGE', async () => {

    it('reduce-one', async () => {
      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {
        // console.log('REDUCE-CALL', msg);
      })

      gate.handle(ctx, cli, [WAMP.REGISTER, 1234, { reducer: true }, 'storage'])
      api.publish('storage', [{ data: 'init-value', count: 1 }], {}, { retain: true })
      api.publish('storage', [{ data: 'value-to-reduce', count: 2 }], {}, { retain: true })

      expect(mockSocket.wampPkgWrite).called.exactly(3)
    })

    it('custom-key-value', async () => {
      const app = new MemKeyValueStorage()
      realm.registerKeyValueEngine(['cache', '*', 'name', '#'], app)

      api.publish('cache.user.name.john', [{ fullName: 'John Doe' }], {}, { retain: true })

      const row = chai.spy((aKey: any, data: any) => {
        expect(aKey).to.deep.equal(['user', 'john'])
        expect(data).to.deep.equal({ args: [], kwargs: { fullName: 'John Doe' } })
      })
      app.getKey(['*', 'john'], row)
      expect(row, 'data has to be saved').called.exactly(1)

      mockSocket.wampPkgWrite = chai.spy((msg: any, callback: any) => {
        if (msg[1] === WAMP.EVENT) {
          expect(msg[3]).to.deep.equal({ topic: 'cache.user.name.john', retained: true })
          expect(msg[4]).to.deep.equal([])
          expect(msg[5]).to.deep.equal({ fullName: 'John Doe' })
        }
      })
      gate.handle(ctx, cli, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'cache.*.name.#'])
      expect(mockSocket.wampPkgWrite).called.exactly(2)
    })
  })
})
