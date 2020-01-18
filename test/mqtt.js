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

    let mqttGate = new MqttGate(router)

    cli = mqttGate.createSession()
    ctx = mqttGate.createContext(cli, sender)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  describe('publish', function () {
    it('to-qos1', function () {
      sender.send = chai.spy(
        function (msg, callback) {}
      )
      cli.handle(ctx, {
        cmd: 'publish',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      })
      expect(sender.send, 'publish confirmed').to.have.been.called.once()
    })

    it('SUBSCRIBE-to-remote-mqtt', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([])
          expect(kwargs).to.deep.equal({ the: 'text' })
        }
      )
      api.subscribe('topic1', subSpy).then((subId) => {
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
    })

    it('SUBSCRIBE-mqtt', function () {
      sender.send = chai.spy(
        function (msg) {
          expect(msg.cmd).to.equal('suback')
        }
      )
      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [ { topic: 'topic1', qos: 0 } ],
        messageId: 1
      })
      expect(sender.send, 'subscribe').to.have.been.called.once()

      sender.send = chai.spy(
        function (msg) {
          expect(msg.cmd).to.equal('publish')
          expect(msg.topic).to.equal('topic1')
        }
      )
      api.publish('topic1', '{ data: 1 }')
      expect(sender.send, 'published').to.have.been.called.once()
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

  it('at-connection-fail-will-publish', function (done) {
    realm.cleanupSession(cli)
    router.getRealm = (realmName, cb) => {cb(realm)}

    sender.send = chai.spy(
      function (msg, callback) {}
    )
    cli.handle(ctx, {
      cmd: 'connect',
      retain: false,
      qos: 0,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      will: 
      { retain: false,
        qos: 0,
        topic: 'disconnect',
        payload: Buffer.from('{"text":"some-test-text"}')
      }
    })

    var subSpy = chai.spy(
      function (publicationId, args, kwargs) {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal({ text: "some-test-text" })
      }
    )
    api.subscribe('disconnect', subSpy).then((subId) => {
      cli.cleanup()
      expect(subSpy).to.have.been.called.once()
      done()
    })
  })
})
