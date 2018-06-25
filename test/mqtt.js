/*jshint mocha: true */
/*jshint node: true */
/*jshint expr: true */
/*jshint esversion: 6 */
'use strict';

var
    chai     = require('chai'),
    spies    = require('chai-spies'),
    expect   = chai.expect,
    Realm    = require('../lib/realm'),
    MqttGate = require('../lib/mqtt/gate'),
    Session  = require('../lib/session'),
    Router   = require('../lib/router');

chai.use(spies);

describe('mqtt-realm', function() {
  var
    router,
    gate,
    realm,
    sender,
    cli,
    api;

  beforeEach(function(){
    sender = {};
    router = new Router();
    realm = new Realm(router);
    api = realm.api();

    gate = new MqttGate(router);
    cli = new Session(gate, sender, gate.makeSessionId());
    realm.joinSession(cli);
    cli.realm = realm;
  });

  afterEach(function(){
  });

  describe('PUBLISH', function() {
    it('SUBSCRIBE-to-remote-mqtt', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.equal(undefined);
          expect(kwargs).to.deep.equal(Buffer.from('text'));
        }
      );
      var subId = api.substopic('topic1', subSpy);

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.PUBLISHED);
          expect(msg[1]).to.equal(2345);
        }
      );
      gate.handle(cli, {
        cmd: 'publish',
        retain: false,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('text')
      });
      expect(sender.send, 'event is published').to.not.have.been.called();

      expect(subSpy, 'publication done').to.have.been.called.once;
      expect(api.unsubstopic(subId)).to.equal('topic1');
    });
  });

});
