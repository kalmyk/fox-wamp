'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const MqttGate = require('../lib/mqtt/gate')
const FoxRouter = require('../lib/fox_router')

chai.use(spies)

describe('22 mqtt-realm', function () {
  var
    router,
    realm,
    sender,
    ctx,
    cli,
    api

  beforeEach(function () {
    sender = {}
    router = new FoxRouter()
    realm = router.getRealm('test-realm')
    api = realm.wampApi()

    const mqttGate = new MqttGate(router)

    cli = mqttGate.createSession()
    ctx = mqttGate.createContext(cli, sender)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  describe('publish', function () {
    it('to-qos1', (done) => {
      sender.send = (msg) => {
        expect(msg.messageId).to.equal(9191)
        expect(msg.cmd).to.equal('puback')
        done()
      }
      cli.handle(ctx, {
        cmd: 'publish',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: 'topic1',
        messageId: 9191,
        payload: Buffer.from('{"the":"text"}')
      })
    })

    it('SUBSCRIBE-to-remote-mqtt', () => {
      let rslt = []

      var subSpy = chai.spy((publicationId, args, kwargs) => {
        rslt.push([args, kwargs])
      })
      return api.subscribe('topic1', subSpy).then((subId) => {
        sender.send = chai.spy((msg, callback) => {})
        cli.handle(ctx, {
          cmd: 'publish',
          retain: false,
          qos: 0,
          dup: false,
          length: 17,
          topic: 'topic1',
          payload: Buffer.from('{"the":"text"}')
        })
        expect(rslt).to.deep.equal([ [ [], { the: 'text' } ] ])
        expect(sender.send, 'no publish confirmation').to.not.have.been.called()

        expect(subSpy, 'publication done').to.have.been.called.once()
        expect(api.unsubscribe(subId)).to.equal('topic1')
      })
    })

    it('SUBSCRIBE-mqtt', function () {
      let rslt = []

      api.publish('topic1', [], { data: 1 }, { retain: true })
      api.publish('topic1', [], { data: 2 }, { retain: true })

      sender.send = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.retain])
      })
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
      expect(rslt).to.deep.equal([
        ['suback',  undefined ],
        ['publish', true      ]
      ])
      expect(sender.send, 'subscribe').to.have.been.called.twice()

      rslt = []
      sender.send = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.topic, msg.retain])
      })
      api.publish('topic1', { data: 3 }, { retain: true })
      expect(rslt).to.deep.equal([['publish', 'topic1', false]])
      expect(sender.send, 'published').to.have.been.called.once()
    })


    it('SUBSCRIBE-retain-one', function () {
      api.publish('topic1.item1', [], { data: 1 }, { retain: true })
      api.publish('topic1.item2', [], { data: 2 }, { retain: true })
      api.publish('topic1.item3', [], { data: 3 }, { retain: true })

      let rslt = []

      sender.send = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.topic])
      })

      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [{ topic: 'topic1/#', qos: 0 }],
        messageId: 1
      })

      expect(rslt).to.deep.equal([
        [ 'suback', undefined ],
        [ 'publish', 'topic1/item1' ],
        [ 'publish', 'topic1/item2' ],
        [ 'publish', 'topic1/item3' ]
      ])
      expect(sender.send, 'call-subscribed').to.have.been.called.exactly(4)
    })

    it('SUBSCRIBE-multi-mqtt', function () {
      let rslt = []

      sender.send = chai.spy((msg) => {
        rslt.push(msg.cmd)
      })
      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [ { topic: 'topic/#', qos: 0 }, { topic: '+/one', qos: 1 } ],
        messageId: 1
      })
      expect(rslt).to.deep.equal(['suback'])
      expect(sender.send, 'subscribe').to.have.been.called.once()

      rslt = []
      sender.send = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.topic, msg.payload.toString()])
      })
      api.publish('topic.one', [], { data: 1 })
      expect(rslt).to.deep.equal([['publish', 'topic/one', '{"data":1}']])
      expect(sender.send, 'published').to.have.been.called.once()
    })

    it('puback', () => {
      let rslt = []

      sender.send = chai.spy((msg) => {
        rslt.push(msg.cmd)
      })
      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [ { topic: 'topic1', qos: 0 }],
        messageId: 1
      })
      expect(rslt).to.deep.equal(['suback'])
      expect(sender.send, 'subscribe').to.have.been.called.once()

      rslt = []
      sender.send = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.topic])
      })
      api.publish('topic1', [], { data: 1 })
      expect(sender.send, 'published').to.have.been.called.once()

      cli.handle(ctx, {
        cmd: 'puback',
        retain: false,
        qos: 0,
        dup: false,
        length: 2,
        topic: null,
        payload: null,
        messageId: 1
      })

      expect(rslt).to.deep.equal([['publish', 'topic1']])
      expect(sender.send, 'puback').to.have.been.called.once()
    })

    it('PUBLISH-to-retain', function (done) {
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

      let subSpy = chai.spy((publicationId, args, kwargs) => {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal({ the: 'text' })
        done()
      })
      api.subscribe('topic1', subSpy, { retained: true })
    })

    it('PUBLISH-retain-clean', function (done) {
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

      const spyClean = chai.spy(() => {})
      api.subscribe('topic-to-clean', spyClean, { retained: true })

      const spyRetain = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([])
          expect(kwargs).to.deep.equal({ the: 'text' })
          expect(spyClean, 'retain value must be cleaned').to.not.have.been.called()
          done()
        }
      )
      api.subscribe('topic-to-retain', spyRetain, { retained: true })
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

      const spyRetain = chai.spy(() => {})
      api.subscribe('batch.#', spyRetain, { retained: true })
      expect(spyRetain).to.have.been.called.exactly(3)
    })
  })

  it('at-connection-fail-will-publish', async () => {
    await realm.leaveSession(cli)
    router.getRealm = (realmName) => realm

    sender.send = chai.spy(() => {})
    cli.handle(ctx, {
      cmd: 'connect',
      retain: false,
      qos: 0,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      will: {
        retain: false,
        qos: 0,
        topic: 'topic-test-disconnect',
        payload: Buffer.from('{"text":"some-test-text"}')
      }
    })

    var subSpy = chai.spy(
      function (publicationId, args, kwargs) {
        expect(args).to.deep.equal([])
        expect(kwargs).to.deep.equal({ text: 'some-test-text' })
      }
    )
    await api.subscribe('topic-test-disconnect', subSpy)
    cli.cleanup()
    expect(subSpy).to.have.been.called.once()
  })

  it('connect-clientid', function (done) {
    realm.leaveSession(cli)
    router.getRealm = (realmName) => realm

    sender.send = chai.spy((msg) => {
      sender.send = nextPublish

      expect(msg.cmd).to.equal('connack')
      expect(msg.sessionPresent).to.equal(false)

      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [{ topic: 'topic1', qos: 1 }],
        messageId: 1
      })
    })

    let pubMsgId

    const nextPublish = chai.spy((msg) => {
      sender.send = nextPuback

      expect(msg.cmd).to.equal('suback')
      pubMsgId = msg.messageId

      api.publish('topic1', [], { data: 1 }, { trace: true })
      expect(realm.engine.getInMessagesCount(), 'trace message need to be saved').to.equal(1)
    })

    const nextPuback = chai.spy((msg) => {
      sender.send = nextConnect

      expect(msg.cmd).to.equal('publish')
      expect(msg.topic).to.equal('topic1')
      expect(msg.qos).to.equal(1)
      expect(msg.payload.toString()).to.equal('{"data":1}')

      cli.handle(ctx, {
        cmd: 'puback',
        retain: false,
        qos: 0,
        dup: false,
        length: 2,
        topic: null,
        payload: null,
        messageId: pubMsgId
      })

      const gotRow = chai.spy((key, value) => {
        expect(key).to.deep.equal(['$FOX', 'clientOffset', 'agent-state'])
        expect(value).to.equal(pubMsgId)
      })

      realm.getKey(['$FOX', 'clientOffset', 'agent-state'], gotRow)
      expect(gotRow).to.have.been.called.once()

      cli.cleanup()
      api.publish('topic1', [], { data: 2 }, { trace: true })

      cli.handle(ctx, {
        cmd: 'connect',
        retain: false,
        qos: 0,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        clean: false,
        username: 'user@test-realm',
        clientId: 'agent-state'
      })
    })

    const nextConnect = chai.spy((msg) => {
      sender.send = nextSubReceive

      expect(msg.cmd).to.equal('connack')
      expect(msg.sessionPresent).to.equal(true)

      cli.handle(ctx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [{ topic: 'topic1', qos: 1 }],
        messageId: 1
      })
    })

    const nextSubReceive = chai.spy((msg) => {
      sender.send = doneEventReceive
      expect(msg.cmd).to.equal('suback')
    })

    const doneEventReceive = chai.spy((msg) => {
      expect(msg.cmd).to.equal('publish')
      expect(msg.topic).to.equal('topic1')
      // expect(msg.qos).to.equal(1)
      expect(msg.payload.toString()).to.equal('{"data":2}')
      done()
    })

    // START HERE
    cli.handle(ctx, {
      cmd: 'connect',
      retain: false,
      qos: 0,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      clean: false,
      username: 'user@test-realm',
      clientId: 'agent-state'
    })
  })
})
