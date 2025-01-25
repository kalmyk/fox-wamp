'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const { MqttGate } = require('../lib/mqtt/gate')
const FoxRouter    = require('../lib/fox_router')

chai.use(spies)

describe('22 mqtt-realm', () => {
  let
    nextPackagePromise,
    socketHistory,
    router,
    realm,
    gate,
    mockSocket,  // inbound socket of mqtt session
    ctx,
    cli,
    api

  function getNextPackage() {
    return new Promise((resolve, reject) => {
      nextPackagePromise = resolve
    })
  }

  beforeEach(() => {
    socketHistory = []
    mockSocket = { mqttPkgWrite: chai.spy(((msg, callback) => {
      if (nextPackagePromise) {
        nextPackagePromise(msg)
        nextPackagePromise = undefined
      } else {
        socketHistory.push(msg)
      }
    }))}
    router = new FoxRouter()
    realm = router.getRealm('test_realm')
    api = realm.api()

    gate = new MqttGate(router)

    cli = router.createSession()
    ctx = gate.createContext(cli, mockSocket)
    realm.joinSession(cli)
  })

  afterEach(function () {
  })

  describe('publish', function () {
    it('qos1-ack-is-received', async () => {
      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: 'topic1',
        messageId: 9191,
        payload: Buffer.from('{"the":"text"}')
      })
      let msg = socketHistory.shift()
      expect(msg.messageId).to.equal(9191)
      expect(msg.cmd).to.equal('puback')
    })

    it('SUB-to-remote-mqtt', async () => {
      let rslt = []
      var subSpy = chai.spy((body) => {
        rslt.push(body)
      })
      let subId = await api.subscribe('topic1', subSpy)
        
      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: false,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      })
      expect(rslt.shift()).to.deep.equal({ the: 'text' })
      expect(mockSocket.mqttPkgWrite, 'no publish confirmation').to.not.have.been.called()

      expect(subSpy, 'publication done').to.have.been.called.once()
      await api.unsubscribe(subId)
    })

    it('SUBSCRIBE-mqtt', async () => {
      await api.publish('topic1', { data: 1 }, { retain: true })
      await api.publish('topic1', { data: 2 }, { retain: true })

      gate.handle(ctx, cli, {
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
      let msg = socketHistory.shift()
      expect(msg.cmd).to.equal('suback')
      msg = socketHistory.shift()
      expect(msg.cmd).to.equal('publish')
      expect(msg.retain).to.equal(true)
      expect(msg.topic).to.equal('topic1')
      expect(msg.payload.toString()).to.equal('{"data":2}')

      await api.publish('topic1', { data: 3 }, { retain: true })

      msg = socketHistory.shift()
      expect(msg.cmd).to.equal('publish')
      expect(msg.retain).to.equal(false)
      expect(msg.topic).to.equal('topic1')
      expect(msg.payload.toString()).to.equal('{"data":3}')

      expect(mockSocket.mqttPkgWrite, 'published').to.have.been.called.exactly(3)
    })


    it('SUBSCRIBE-retain-one', function () {
      api.publish('topic1.item1', { data: 1 }, { retain: true })
      api.publish('topic1.item2', { data: 2 }, { retain: true })
      api.publish('topic1.item3', { data: 3 }, { retain: true })

      let rslt = []

      mockSocket.mqttPkgWrite = chai.spy((msg) => {
        rslt.push([msg.cmd, msg.topic])
      })

      gate.handle(ctx, cli, {
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
      expect(mockSocket.mqttPkgWrite, 'call-subscribed').to.have.been.called.exactly(4)
    })

    it('SUBSCRIBE-multi-mqtt', async () => {
      gate.handle(ctx, cli, {
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
      let msg = socketHistory.shift()
      expect(msg.cmd).to.deep.equal('suback')

      await api.publish('topic.one', { data: 1 })
      msg = socketHistory.shift()
      expect(msg.cmd).to.deep.equal('publish')
      expect(msg.topic).to.deep.equal('topic/one')
      expect(msg.payload.toString()).to.deep.equal('{"data":1}')

      expect(mockSocket.mqttPkgWrite, 'published').to.have.been.called.twice()
    })

    it('puback', async () => {
      gate.handle(ctx, cli, {
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
      let msg = socketHistory.shift()
      expect(msg.cmd).to.deep.equal('suback')

      await api.publish('topic1', { data: 1 })
      msg = socketHistory.shift()
      expect(msg.cmd).to.deep.equal('publish')
      expect(msg.topic).to.deep.equal('topic1')
      expect(msg.payload.toString()).to.deep.equal('{"data":1}')

      gate.handle(ctx, cli, {
        cmd: 'puback',
        retain: false,
        qos: 0,
        dup: false,
        length: 2,
        topic: null,
        payload: null,
        messageId: 1
      })

      msg = socketHistory.shift()
      expect(mockSocket.mqttPkgWrite).to.have.been.called.twice()
    })

    it('PUBLISH-to-retain', async () => {
      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      })
      expect(mockSocket.mqttPkgWrite, 'no publish confirmation').to.not.have.been.called()

      const calls = []
      let subSpy = chai.spy(body => calls.push(body))
      await api.subscribe('topic1', subSpy, { retained: true })
      expect(calls.shift()).to.deep.equal({ the: 'text' })
    })

    it('PUBLISH-retain-clean', async () => {
      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-retain',
        payload: Buffer.from('{"the":"text-to-retain"}')
      })

      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-clean',
        payload: Buffer.from('{"the":"text-to-clean"}')
      })

      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic-to-clean',
        payload: Buffer.from('')
      })

      const spyClean = chai.spy(() => {})
      await api.subscribe('topic-to-clean', spyClean, { retained: true })

      const pubs = []
      const spyRetain = chai.spy(body => pubs.push(body))
      await api.subscribe('topic-to-retain', spyRetain, { retained: true })

      expect(spyClean, 'retain value must be cleaned').to.not.have.been.called()

      let pub = pubs.shift()
      expect(pub).to.deep.equal({ the: 'text-to-retain' })
      expect(spyRetain, 'retain value must be cleaned').to.have.been.called.once()
    })

    it('SUBSCRIBE-retain-batch', async () => {
      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k1',
        payload: Buffer.from('{"the":"text k1"}')
      })

      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k2',
        payload: Buffer.from('{"the":"text k2"}')
      })

      gate.handle(ctx, cli, {
        cmd: 'publish',
        retain: true,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'batch.k3',
        payload: Buffer.from('{"the":"text k3"}')
      })

      const spyRetain = chai.spy(() => {})
      await api.subscribe('batch.#', spyRetain, { retained: true })
      expect(spyRetain).to.have.been.called.exactly(3)
    })
  })

  it('at-connection-fail-will-publish', async () => {
    await realm.leaveSession(cli)
    router.getRealm = (realmName) => realm

    gate.handle(ctx, cli, {
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

    const pubs = []
    const subSpy = chai.spy(body => pubs.push(body))
    await api.subscribe('topic-test-disconnect', subSpy)
    cli.cleanup()
    expect(subSpy).to.have.been.called.once()
    expect(pubs.shift()).to.deep.equal({ text: 'some-test-text' })
  })

  it('connect-clientid', async () => {
    realm.leaveSession(cli)
    router.getRealm = (realmName) => realm

    let nextPackage = getNextPackage()
    gate.handle(ctx, cli, {
      cmd: 'connect',
      retain: false,
      qos: 0,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      clean: false,
      username: 'user@test-realm',
      clientId: 'worker-state'
    })
    let msg = await nextPackage
    expect(msg.cmd).to.equal('connack')
    expect(msg.sessionPresent).to.equal(false)

    gate.handle(ctx, cli, {
      cmd: 'subscribe',
      retain: false,
      qos: 1,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      subscriptions: [{ topic: 'topic/1', qos: 1 }],
      messageId: 1
    })

    msg = socketHistory.shift()
    expect(msg.cmd).to.equal('suback')

    await api.publish('topic.1', { data: 1 }, { trace: true })
    expect(realm.engine.getInMessagesCount(), 'trace message need to be saved').to.equal(1)

    msg = socketHistory.shift()
    expect(msg.cmd).to.equal('publish')
    expect(msg.topic).to.equal('topic/1')
    expect(msg.qos).to.equal(1)
    expect(msg.payload.toString()).to.equal('{"data":1}')
    let pubMsgId = msg.messageId

    // save worker position, the message considered as handled
    gate.handle(ctx, cli, {
      cmd: 'puback',
      retain: false,
      qos: 0,
      dup: false,
      length: 2,
      topic: null,
      payload: null,
      messageId: pubMsgId
    })

    const offsetRow = []
    const gotRow = chai.spy((key, value) => { offsetRow.push({key, value}) })
    await realm.getKey(['$FOX', 'clientOffset', 'worker-state'], gotRow)
    expect(gotRow).to.have.been.called.once()
    const row = offsetRow.shift()
    expect(row.key).to.deep.equal(['$FOX', 'clientOffset', 'worker-state'])
    // expect(row.value).to.equal(pubMsgId) -- some non zero value

    cli.cleanup()
    await api.publish('topic.1', { data: 2 }, { trace: true })

    nextPackage = getNextPackage()
    gate.handle(ctx, cli, {
      cmd: 'connect',
      retain: false,
      qos: 0,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      clean: false,
      username: 'user@test-realm',
      clientId: 'worker-state'
    })
    msg = await nextPackage
    expect(msg.cmd).to.equal('connack')
    expect(msg.sessionPresent).to.equal(true)

    gate.handle(ctx, cli, {
      cmd: 'subscribe',
      retain: false,
      qos: 1,
      dup: false,
      length: 17,
      topic: null,
      payload: null,
      subscriptions: [{ topic: 'topic/1', qos: 1 }],
      messageId: 1
    })

    msg = socketHistory.shift()
    expect(msg.cmd).to.equal('suback')

    msg = socketHistory.shift()
    expect(msg.cmd).to.equal('publish')
    expect(msg.topic).to.equal('topic/1')
    // expect(msg.qos).to.equal(1)
    expect(msg.payload.toString()).to.equal('{"data":2}')
  })
})
