'use strict';

var
    chai     = require('chai'),
    spies    = require('chai-spies'),
    expect   = chai.expect,
    Realm    = require('../lib/realm').Realm,
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

  describe('publish', function() {
    it('SUBSCRIBE-to-remote-mqtt', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal([]);
          expect(kwargs).to.deep.equal({the:'text'});
        }
      );
      var subId = api.substopic('topic1', subSpy);

      sender.send = chai.spy(
        function (msg, callback) {}
      );
      gate.handle(cli, {
        cmd: 'publish',
        retain: false,
        qos: 0,
        dup: false,
        length: 17,
        topic: 'topic1',
        payload: Buffer.from('{"the":"text"}')
      });
      expect(sender.send, 'no publish confirmation').to.not.have.been.called();

      expect(subSpy, 'publication done').to.have.been.called.once();
      expect(api.unsubstopic(subId)).to.equal('topic1');
    });
  });

});
