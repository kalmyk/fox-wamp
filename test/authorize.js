'use strict'

const chai = require('chai')
const spies = require('chai-spies')
const expect = chai.expect

const Realm    = require('../lib/realm').Realm
const WAMP     = require('../lib/wamp/protocol')
const WampGate = require('../lib/wamp/gate')
const MqttGate = require('../lib/mqtt/gate')
const Router   = require('../lib/router')

chai.use(spies)

const Auth = function () {
  this.authorize = function (session, funcClass, uniUri) {
    // console.log('!authorize', funcClass, uniUri)
    return uniUri[1] !== 'denied'
  }
}

describe('authorize', function () {
  var
    router,
    mqttGate,
    wampGate,
    realm,
    mqttSender,
    wampSender,
    wampCtx,
    mqttCtx,
    mqttCli,
    wampCli

  beforeEach(function () {
    let auth = new Auth()
    mqttSender = {}
    wampSender = {}
    router = new Router()
    realm = new Realm(router)

    mqttGate = new MqttGate(router)
    mqttGate.setAuthHandler(auth)

    wampGate = new WampGate(router)
    wampGate.setAuthHandler(auth)

    mqttCli = mqttGate.createSession()
    mqttCtx = mqttGate.createContext(mqttCli, mqttSender)
    realm.joinSession(mqttCli)

    wampCli = wampGate.createSession()
    wampCtx = wampGate.createContext(wampCli, wampSender)
    realm.joinSession(wampCli)
  })

  afterEach(function () {
  })

  describe('wamp', function () {
    it('subscribe', function () {
      wampSender.send = chai.spy(
        function (msg) {
          expect(msg[0]).to.equal(WAMP.SUBSCRIBED)
          expect(msg[1]).to.equal(1234)
        }
      )
      wampCli.handle(wampCtx, [WAMP.SUBSCRIBE, 1234, {}, 'topic1.passed'])
      expect(wampSender.send, 'subscription confirmed').to.have.been.called.once()

      wampSender.send = chai.spy(
        function (msg) {
          expect(msg[0]).to.equal(WAMP.ERROR)
          expect(msg[1]).to.equal(WAMP.SUBSCRIBE)
          expect(msg[2]).to.equal(1234)
          expect(msg[4]).to.equal('wamp.error.authorization_failed')
        }
      )
      wampCli.handle(wampCtx, [WAMP.SUBSCRIBE, 1234, {}, 'topic1.denied'])
      expect(wampSender.send, 'subscription confirmed').to.have.been.called.once()
    })
  })

  describe('mqtt', function () {
    it('subscribe', function () {
      mqttSender.send = chai.spy((msg) => {
        expect(msg).to.deep.equal({cmd: 'suback', messageId: 321, granted: [ 128, 1 ]})
      })
      mqttCli.handle(mqttCtx, {
        cmd: 'subscribe',
        retain: false,
        qos: 1,
        dup: false,
        length: 17,
        topic: null,
        payload: null,
        subscriptions: [
          { topic: 'topic1/denied', qos: 0 },
          { topic: 'topic1/passed', qos: 2 }
        ],
        messageId: 321
      })
      expect(mqttSender.send).to.have.been.called.once()
    })
  })
})
