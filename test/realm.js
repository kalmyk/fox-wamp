'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const WAMP     = require('../lib/wamp/protocol')
const WampGate = require('../lib/wamp/gate')
const Router   = require('../lib/router')
const MemKeyValueStorage = require('../lib/memkv').MemKeyValueStorage

chai.use(spies)

describe('wamp-realm', function () {
  let
    router,
    gate,
    realm,
    sender,
    ctx,
    cli,
    api

  beforeEach(function () {
    sender = {}
    router = new Router()
    realm = router.createRealm('test-realm')
    api = realm.wampApi()

    gate = new WampGate(router)
    cli = gate.createSession()
    ctx = gate.createContext(cli, sender)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  it('empty cleanup', function () {
    realm.cleanupSession(api)
  })

  it('session-list', function () {
    let result = realm.getSessionIds()
    expect(result).to.be.an('array').that.is.not.empty
  })

  describe('RPC', function () {
    it('CALL to RPC not exist', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.CALL)
          expect(msg[2]).to.equal(1234)
          expect(msg[4]).to.equal('wamp.error.no_such_procedure')
          expect(msg[5]).to.deep.equal(['no callee registered for procedure <any.function.name>'])
        }
      )
      cli.handle(ctx, [WAMP.CALL, 1234, {}, 'any.function.name', []])
      expect(sender.send).to.have.been.called.once()
    })

    it('cleanup RPC API', function () {
      var procSpy = chai.spy(function () {})
      api.register('func1', procSpy)
      expect(api.cleanupReg(realm.engine)).to.equal(1)
      expect(api.cleanupReg(realm.engine)).to.equal(0)
      expect(procSpy).to.not.have.been.called()
    })

    it('CALL-to-router', function () {
      var procSpy = chai.spy(function (id, args, kwargs) {
        api.resrpc(id, undefined, ['result.1', 'result.2'], { kVal: 'kRes' })
      })
      var regId = api.register('func1', procSpy)

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.RESULT)
          expect(msg[1]).to.equal(1234)
          expect(msg[3]).to.deep.equal(['result.1', 'result.2'])
          expect(msg[4]).to.deep.equal({ kVal: 'kRes' })
        }
      )
      cli.handle(ctx, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], { kArg: 'kVal' }])
      expect(procSpy, 'RPC delivered').to.have.been.called.once()
      expect(sender.send, 'result delivered').to.have.been.called.once()
      expect(api.unregister(regId)).to.equal('func1')
    })

    it('CALL to router with error', function () {
      var callId = null
      var procSpy = chai.spy(function (id, args, kwargs) {
        callId = id
      })
      api.register('func1', procSpy)
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.CALL)
          expect(msg[2]).to.equal(1234)
          expect(msg[4]).to.deep.equal('wamp.error.callee_failure')
        }
      )
      cli.handle(ctx, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], { kArg: 'kVal' }])
      api.resrpc(callId, 1, ['result.1', 'result.2'], { kVal: 'kRes' })
      expect(procSpy).to.have.been.called.once()
      expect(sender.send).to.have.been.called.once()
    })

    it('UNREGISTER error', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.UNREGISTER)
          expect(msg[2]).to.equal(2345)
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_registration')
        }
      );
      cli.handle(ctx, [WAMP.UNREGISTER, 2345, 1234567890])
      expect(sender.send, 'unregistration confirmed').to.have.been.called.once()
    })

    it('UNREGISTER', function () {
      var qid = null

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.REGISTERED)
          expect(msg[1]).to.equal(1234)
          qid = msg[2]
        }
      )
      cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])
      expect(sender.send, 'registration confirmed').to.have.been.called.once()

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.UNREGISTERED)
          expect(msg[1]).to.equal(2345)
        }
      )
      cli.handle(ctx, [WAMP.UNREGISTER, 2345, qid])
      expect(sender.send, 'unregistration confirmed').to.have.been.called.once()
    })

    it('CALL-to-remote', function () {
      let qid = null

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.REGISTERED)
          expect(msg[1]).to.equal(1234)
          qid = msg[2]
        }
      )
      cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])
      expect(sender.send, 'registration confirmed').to.have.been.called.once()

      var callId = null
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.INVOCATION)
          callId = msg[1]
          expect(msg[2]).to.equal(qid)
          expect(msg[3]).to.deep.equal({}) // options
          expect(msg[4]).to.deep.equal(['arg.1', 'arg.2'])
          expect(msg[5]).to.deep.equal({ kVal: 'kRes' })
        }
      )
      var callResponse = chai.spy(function (err, args, kwargs) {
        expect(err).to.be.undefined
        expect(args).to.deep.equal(['result.1', 'result.2'], 'args call spy response')
        expect(kwargs).to.deep.equal({ foo: 'bar' }, 'kwargs call spy response')
      })
      api.callrpc('func1', ['arg.1','arg.2'], { kVal: 'kRes' }, callResponse)
      expect(sender.send, 'invocation received').to.have.been.called.once()

      // return the function result
      cli.handle(ctx, [WAMP.YIELD, callId, {}, ['result.1', 'result.2'], { foo: 'bar' }])

      expect(callResponse, 'result delivered').to.have.been.called.once()
    })

    it('CALL error to remote', function () {
      sender.send = function () {}
      cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])

      var callId = null
      sender.send = chai.spy(
        function (msg, callback) {
          callId = msg[1]
        }
      )
      var callSpy = chai.spy(function (err, args) {
        expect(err).to.be.an('error')
        expect(args).to.deep.equal(['err.detail.1', 'err.detail.2'])
      })
      api.callrpc('func1', ['arg.1', 'arg.2'], { kVal: 'kRes' }, callSpy)
      expect(sender.send, 'invocation received').to.have.been.called.once()

      cli.handle(ctx, [WAMP.ERROR, WAMP.INVOCATION, callId, {}, 'wamp.error.runtime_error', ['err.detail.1', 'err.detail.2']])
      expect(callSpy, 'error delivered').to.have.been.called.once()
    })

    it('CALL-set-concurrency', function () {
      sender.send = function () {}
      cli.handle(ctx, [WAMP.REGISTER, 1234, { concurrency: 2 }, 'func1'])

      sender.send = chai.spy((msg, callback) => {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})

      expect(sender.send).to.have.been.called.twice()
    })

    it('CALL-concurrency-unlimited', function () {
      sender.send = function () {}
      cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])

      sender.send = chai.spy((msg, callback) => {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})
      api.callrpc('func1', [], {})

      expect(sender.send).to.have.been.called.exactly(3)
    })

    it('progress-remote-CALL', function () {
      sender.send = function (msg, callback) {}
      cli.handle(ctx, [WAMP.REGISTER, 1234, {}, 'func1'])

      let callId = null
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.INVOCATION)
          callId = msg[1]
          // qid
          expect(msg[3]).to.deep.equal({ receive_progress: true })
        }
      )
      let result
      let options
      let callResponse = chai.spy(function (err, args, kwargs, opt) {
        expect(err).to.equal(undefined)
        expect(args).to.deep.equal(result)
        expect(opt).to.deep.equal(options)
      })
      api.callrpc('func1', [], {}, callResponse, { receive_progress: 1 })
      expect(sender.send, 'invocation received').to.have.been.called.once()

      result = ['result.1']
      options = { progress: true }
      cli.handle(ctx, [WAMP.YIELD, callId, { progress: true }, ['result.1']])

      result = ['result.2']
      options = { progress: true }
      cli.handle(ctx, [WAMP.YIELD, callId, { progress: true }, ['result.2']])

      result = ['result.3.final']
      options = {}
      cli.handle(ctx, [WAMP.YIELD, callId, {}, ['result.3.final']])

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
        }
      )
      cli.handle(ctx, [WAMP.YIELD, callId, {}, ['result.response.error']])

      expect(callResponse, 'result delivered').to.have.been.called.exactly(3)
    })
  })

  describe('PUBLISH', function () {
    it('UNSUBSCRIBE-ERROR', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.UNSUBSCRIBE)
          expect(msg[2]).to.equal(2345)
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_subscription')
        }
      )
      cli.handle(ctx, [WAMP.UNSUBSCRIBE, 2345, 1234567890])
      expect(sender.send, 'unsubscription confirmed').to.have.been.called.once()
    })

    it('UNSUBSCRIBE-OK', function () {
      var subscriptionId = null

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
          expect(msg[1]).to.equal(1234)
          subscriptionId = msg[2]
        }
      )
      cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      expect(sender.send, 'subscription confirmed').to.have.been.called.once()

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.UNSUBSCRIBED)
          expect(msg[1]).to.equal(2345)
        }
      )
      cli.handle(ctx, [WAMP.UNSUBSCRIBE, 2345, subscriptionId])
      expect(sender.send, 'unsubscription confirmed').to.have.been.called.once()
    })

    it('cleanup Topic API', function () {
      var subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      expect(api.cleanupTrace(realm.engine)).to.equal(1)
      expect(api.cleanupTrace(realm.engine)).to.equal(0)
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH default exclude_me:true', function () {
      var subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      api.publish('topic1', [], {})
      expect(subSpy).to.not.have.been.called()
    })

    it('PUBLISH exclude_me:false', function () {
      var subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      api.publish('topic1', [], {}, { exclude_me: false })
      expect(subSpy).to.have.been.called.once()
    })

    it('PUBLISH-to-pattern', function () {
      var subSpy = chai.spy(function (a, b, c, d) {
        // console.log('Publish Event', a,b,c,d)
      })
      api.subscribe('topic1.*.item', subSpy)
      api.publish('topic1.123.item', [], {}, { exclude_me: false })
      expect(subSpy).to.have.been.called.once()
    })

    it('PUBLISH-to-remote', function () {
      var subscriptionId = null

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
          expect(msg[1]).to.equal(1234)
          subscriptionId = msg[2]
        }
      )
      cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, {}, 'topic1'])
      expect(sender.send, 'subscription confirmed').to.have.been.called.once()

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.EVENT)
          expect(msg[1]).to.equal(subscriptionId)
          // 2 published message Id
          expect(msg[3]).to.deep.equal({ topic: 'topic1' })
          expect(msg[4]).to.deep.equal(['arg.1', 'arg.2'])
          expect(msg[5]).to.deep.equal({ foo: 'bar' })
        }
      )
      api.publish('topic1', ['arg.1', 'arg.2'], { foo: 'bar' })
      expect(sender.send, 'publication received').to.have.been.called.once()
    })

    it('SUBSCRIBE-to-remote', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal(['arg.1', 'arg.2'])
          expect(kwargs).to.deep.equal({ foo: 'bar' })
        }
      )
      api.subscribe('topic1', subSpy).then((subId) => {
        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.PUBLISHED)
            expect(msg[1]).to.equal(2345)
          }
        )
        cli.handle(ctx, [WAMP.PUBLISH, 1234, {}, 'topic1', ['arg.1', 'arg.2'], { foo: 'bar' }])
        expect(sender.send, 'published').to.not.have.been.called()
        cli.handle(ctx, [WAMP.PUBLISH, 2345, { acknowledge: true }, 'topic1', ['arg.1', 'arg.2'], { foo: 'bar' }])
        expect(sender.send, 'published').to.have.been.called.once()

        expect(subSpy, 'publication done').to.have.been.called.twice()
        expect(api.unsubscribe(subId)).to.equal('topic1')
      })

    })
  })

  describe('STORAGE', function () {
    it('retain-get', function (done) {
      var subSpy = chai.spy(function () {})
      api.subscribe('topic1', subSpy)
      api.publish('topic1', [], { data: 'retain-the-value' }, { retain: 100 })
      api.publish('topic1', [], { data: 'the-value-does-not-retain' })

      let counter = 2
      sender.send = chai.spy(
        (msg, callback) => {
          // console.log('MSG', counter, msg)
          if (counter === 2) {
            expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
            expect(msg[1]).to.equal(1234)
          } else {
            expect(msg[0]).to.equal(WAMP.EVENT)
            expect(msg[3]).to.deep.equal({ topic: 'topic1', retained: true })
            expect(msg[5]).to.deep.equal({ data: 'retain-the-value' })
          }
          --counter
          if (!counter) {
            done()
          }
        }
      )
      cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'topic1'])
    })

    it('retain-weak', function () {
      cli.handle(ctx, [WAMP.PUBLISH, 1234, { retain: 0, weak: 'public' }, 'topic2', ['arg.1', 'arg.2'], {}])
      // console.log('key', realm.getKey('topic2'))
      realm.cleanupSession(cli)
      // console.log('key', realm.getKey('topic2'))
    })

    it('wamp-key-remove', function () {
      cli.handle(ctx, [WAMP.PUBLISH, 1234, { retain: true }, 'topic2', [], { some: 'value' }])

      const gotRow = chai.spy((key, value) => {
        expect(key).to.deep.equal(['topic2'])
        expect(value).to.deep.equal({ args: [], kwargs: { some: 'value' } })
      })

      const noRow = chai.spy(() => {})

      return realm.getKey(['topic2'], gotRow).then(() => {
        expect(gotRow).to.have.been.called.exactly(1)

        // no kwargs sent if kwargs passed as null
        cli.handle(ctx, [WAMP.PUBLISH, 1234, { retain: true }, 'topic2', []])

        return realm.getKey(['topic2'], noRow)
      }).then(() => {
        expect(noRow, 'row need to be removed').to.have.not.been.called()
      })
    })

    it('reduce-one', function () {
      sender.send = chai.spy((msg, callback) => {
        // console.log('REDUCE-CALL', msg);
      })

      cli.handle(ctx, [WAMP.REGISTER, 1234, { reducer: true }, 'storage'])
      api.publish('storage', [], { data: 'init-value', count: 1 }, { retain: true })
      api.publish('storage', [], { data: 'value-to-reduce', count: 2 }, { retain: true })

      expect(sender.send).to.have.been.called.exactly(3)
    })

    it('custom-key-value', function () {
      const app = new MemKeyValueStorage()
      realm.registerKeyValueEngine(['cache', '*', 'name', '#'], app)

      api.publish('cache.user.name.john', [], { fullName: 'John Doe' }, { retain: true })

      const row = chai.spy((aKey, data) => {
        expect(aKey).to.deep.equal(['user', 'john'])
        expect(data).to.deep.equal({ args: [], kwargs: { fullName: 'John Doe' } })
      })
      app.getKey(['*', 'john'], row)
      expect(row, 'data has to be saved').to.have.been.called.exactly(1)

      sender.send = chai.spy((msg, callback) => {
        if (msg[1] === WAMP.EVENT) {
          expect(msg[3]).to.deep.equal({ topic: 'cache.user.name.john', retained: true })
          expect(msg[4]).to.deep.equal([])
          expect(msg[5]).to.deep.equal({ fullName: 'John Doe' })
        }
      })
      cli.handle(ctx, [WAMP.SUBSCRIBE, 1234, { retained: true }, 'cache.*.name.#'])
      expect(sender.send).to.have.been.called.exactly(2)
    })
  })
})
