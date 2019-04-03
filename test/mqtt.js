'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const Realm    = require('../lib/realm').Realm
const MqttGate = require('../lib/mqtt/gate')
const Router   = require('../lib/router')

chai.use(spies)

describe('mqtt-realm', function () {
  var
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
    realm = new Realm(router)
    api = realm.wampApi()

    gate = new MqttGate(router)
    ctx = router.createContext()
    cli = router.createSession(gate, sender)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  describe('publish', function () {
    it('SUBSCRIBE-to-remote-mqtt', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([])
          expect(kwargs).to.deep.equal({ the: 'text' })
        }
      )
      var subId = api.subscribe('topic1', subSpy)

      sender.send = chai.spy(
        function (msg, callback) {}
      )
      cli.handle(ctx, {
        cmd: 'publish',
        retain: false,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      })
      expect(sender.send, 'no publish confirmation').to.not.have.been.called()

      expect(subSpy, 'publication done').to.have.been.called.once()
      expect(api.unsubscribe(subId)).to.equal('topic1')
    })

    it('SUBSCRIBE-to-retain', function (done) {
      sender.send = chai.spy((msg, callback) => {})
      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      })
      expect(sender.send, 'no publish confirmation').to.not.have.been.called()

      let subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([])
          expect(kwargs).to.deep.equal({ the: 'text' })
          done()
        }
      )
      api.subscribe('topic1', subSpy)
    })

    it('SUBSCRIBE-retain-clean', function (done) {
      sender.send = chai.spy((msg, callback) => {})

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-retain',
        payload: Buffer.from('{"the":"text"}')
      })

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-clean',
        payload: Buffer.from('{"the":"text"}')
      })

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-clean',
        payload: Buffer.from('')
      })

      let spyClean = chai.spy(() => {})
      api.subscribe('topic-to-clean', spyClean)

      let spyRetain = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([])
          expect(kwargs).to.deep.equal({ the: 'text' })
          expect(spyClean, 'retain value must be cleaned').to.not.have.been.called()
          done()
        }
      )
      api.subscribe('topic-to-retain', spyRetain)
    })

    it('SUBSCRIBE-retain-batch', function () {
      sender.send = chai.spy((msg, callback) => {})

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k1',
        payload: Buffer.from('{"the":"text k1"}')
      })

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k2',
        payload: Buffer.from('{"the":"text k2"}')
      })

      cli.handle(ctx, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k3',
        payload: Buffer.from('{"the":"text k3"}')
      })

      let spyRetain = chai.spy(() => {})
      api.subscribe('batch.#', spyRetain)
      expect(spyRetain).to.have.been.called.exactly(3)
    })
  })
})
