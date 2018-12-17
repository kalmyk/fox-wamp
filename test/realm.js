/*jshint mocha: true */
/*jshint node: true */
/*jshint expr: true */
/*jshint esversion: 6 */
'use strict';

var
    chai     = require('chai'),
    spies    = require('chai-spies'),
    expect   = chai.expect,
    WAMP     = require('../lib/wamp/protocol'),
    Realm    = require('../lib/realm').Realm,
    WampGate = require('../lib/wamp/gate'),
    Session  = require('../lib/session'),
    Router   = require('../lib/router');

chai.use(spies);

describe('wamp-realm', function() {
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

    gate = new WampGate.WampHandler(router, new WampGate.WampEncoder());
    cli = new Session(gate.getEncoder(), sender, gate.makeSessionId());
    realm.joinSession(cli);
    cli.realm = realm;
  });

  afterEach(function(){
  });

  it('empty cleanup', function () {
    realm.cleanupSession(api);
  });

  it('session-list', function () {
    let result = realm.getSessionIds();
    expect(result).to.be.an('array').that.is.not.empty;
  });

  describe('RPC', function() {
    it('CALL to RPC not exist', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR);
          expect(msg[1]).to.equal(WAMP.CALL);
          expect(msg[2]).to.equal(1234);
          expect(msg[4]).to.equal('wamp.error.no_such_procedure');
          expect(msg[5]).to.deep.equal([ 'no callee registered for procedure <any.function.name>' ]);
        }
      );
      gate.handle(cli, [WAMP.CALL, 1234, {}, 'any.function.name', []]);
      expect(sender.send).to.have.been.called.once();
    });

    it('cleanup RPC API', function () {
      var procSpy = chai.spy(function() {});
      api.regrpc('func1', procSpy);
      expect(api.cleanupReg(realm.rpc)).to.equal(1);
      expect(api.cleanupReg(realm.rpc)).to.equal(0);
      expect(procSpy).to.not.have.been.called();
    });

    it('CALL to router', function () {
      var procSpy = chai.spy(function(id, args, kwargs) {
        api.resrpc(id, undefined, ['result.1','result.2'], {kVal:'kRes'});
      });
      var regId = api.regrpc('func1', procSpy);

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.RESULT);
          expect(msg[1]).to.equal(1234);
          expect(msg[3]).to.deep.equal(['result.1','result.2']);
          expect(msg[4]).to.deep.equal({kVal:'kRes'});
        }
      );
      gate.handle(cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], {'kArg':'kVal'}]);
      expect(procSpy, 'RPC delivered').to.have.been.called.once();
      expect(sender.send, 'result delivered').to.have.been.called.once();
      expect(api.unregrpc(regId)).to.equal('func1');
    });

    it('CALL to router with error', function () {
      var callId = null;
      var procSpy = chai.spy(function(id, args, kwargs) {
        callId = id;
      });
      api.regrpc('func1', procSpy);
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR);
          expect(msg[1]).to.equal(WAMP.CALL);
          expect(msg[2]).to.equal(1234);
          expect(msg[4]).to.deep.equal('wamp.error.callee_failure');
        }
      );
      gate.handle(cli, [WAMP.CALL, 1234, {}, 'func1', ['arg1', 'arg2'], {'kArg':'kVal'}]);
      api.resrpc(callId, 1, ['result.1','result.2'], {kVal:'kRes'});
      expect(procSpy).to.have.been.called.once();
      expect(sender.send).to.have.been.called.once();
    });

    it('UNREGISTER error', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR);
          expect(msg[1]).to.equal(WAMP.UNREGISTER);
          expect(msg[2]).to.equal(2345);
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_registration');
        }
      );
      gate.handle(cli, [WAMP.UNREGISTER, 2345, 1234567890]);
      expect(sender.send, 'unregistration confirmed').to.have.been.called.once();
    });

    it('UNREGISTER', function () {
      var qid = null;

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.REGISTERED);
          expect(msg[1]).to.equal(1234);
          qid = msg[2];
        }
      );
      gate.handle(cli, [WAMP.REGISTER, 1234, {}, 'func1']);
      expect(sender.send, 'registration confirmed').to.have.been.called.once();

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.UNREGISTERED);
          expect(msg[1]).to.equal(2345);
        }
      );
      gate.handle(cli, [WAMP.UNREGISTER, 2345, qid]);
      expect(sender.send, 'unregistration confirmed').to.have.been.called.once();
    });

    it('CALL-to-remote', function () {
        let qid = null;

        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.REGISTERED);
            expect(msg[1]).to.equal(1234);
            qid = msg[2];
          }
        );
        gate.handle(cli, [WAMP.REGISTER, 1234, {}, 'func1']);
        expect(sender.send, 'registration confirmed').to.have.been.called.once();

        var callId = null;
        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.INVOCATION);
            callId = msg[1];
            expect(msg[2]).to.equal(qid);
            expect(msg[3]).to.deep.equal({});  // options
            expect(msg[4]).to.deep.equal(['arg.1','arg.2']);
            expect(msg[5]).to.deep.equal({kVal:'kRes'});
          }
        );
        var callResponse = chai.spy(function(err, args, kwargs) {
          expect(err).to.be.undefined;
          expect(args).to.deep.equal(['result.1','result.2'], 'args call spy response');
          expect(kwargs).to.deep.equal({foo:'bar'}, 'kwargs call spy response');
        });
        api.callrpc('func1', ['arg.1','arg.2'], {kVal:'kRes'}, callResponse);
        expect(sender.send, 'invocation received').to.have.been.called.once();

        // return the function result
        gate.handle(cli, [WAMP.YIELD, callId, {}, ['result.1','result.2'], {foo:'bar'}]);

        expect(callResponse, 'result delivered').to.have.been.called.once();
    });

    it('CALL error to remote', function () {
        sender.send = function () {};
        gate.handle(cli, [WAMP.REGISTER, 1234, {}, 'func1']);

        var callId = null;
        sender.send = chai.spy(
          function (msg, callback) {
            callId = msg[1];
          }
        );
        var callSpy = chai.spy(function(err, args) {
          expect(err).to.be.an('error');
          expect(args).to.deep.equal(['err.detail.1','err.detail.2']);
        });
        api.callrpc('func1', ['arg.1','arg.2'], {kVal:'kRes'}, callSpy);
        expect(sender.send, 'invocation received').to.have.been.called.once();

        gate.handle(cli, [WAMP.ERROR, WAMP.INVOCATION, callId, {}, 'wamp.error.runtime_error', ['err.detail.1','err.detail.2']]);
        expect(callSpy, 'error delivered').to.have.been.called.once();
    });

    it('progress-remote-CALL', function () {
      sender.send = function (msg, callback) {};
      gate.handle(cli, [WAMP.REGISTER, 1234, {}, 'func1']);

      let callId = null;
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.INVOCATION);
          callId = msg[1];
          // qid
          expect(msg[3]).to.deep.equal({receive_progress:true});
        }
      );
      let result;
      let options;
      let callResponse = chai.spy(function(err, args, kwargs, opt) {
        expect(err).to.be.undefined;
        expect(args).to.deep.equal(result);
        expect(opt).to.deep.equal(options);
      });
      api.callrpc('func1', [], {}, callResponse, {receive_progress:1});
      expect(sender.send, 'invocation received').to.have.been.called.once();

      result = ['result.1'];
      options = {progress:true};
      gate.handle(cli, [WAMP.YIELD, callId, {progress:true}, ['result.1']]);

      result = ['result.2'];
      options = {progress:true};
      gate.handle(cli, [WAMP.YIELD, callId, {progress:true}, ['result.2']]);

      result = ['result.3.final'];
      options = {};
      gate.handle(cli, [WAMP.YIELD, callId, {}, ['result.3.final']]);

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR);
        }
      );
      gate.handle(cli, [WAMP.YIELD, callId, {}, ['result.response.error']]);

      expect(callResponse, 'result delivered').to.have.been.called.exactly(3);
    });
  });

  describe('PUBLISH', function() {
    it('UNSUBSCRIBE-ERROR', function () {
      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.ERROR);
          expect(msg[1]).to.equal(WAMP.UNSUBSCRIBE);
          expect(msg[2]).to.equal(2345);
          // 3 options
          expect(msg[4]).to.equal('wamp.error.no_such_subscription');
        }
      );
      gate.handle(cli, [WAMP.UNSUBSCRIBE, 2345, 1234567890]);
      expect(sender.send, 'unsubscription confirmed').to.have.been.called.once();
    });

    it('UNSUBSCRIBE-OK', function () {
        var subscriptionId = null;

        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.SUBSCRIBED);
            expect(msg[1]).to.equal(1234);
            subscriptionId = msg[2];
          }
        );
        gate.handle(cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1']);
        expect(sender.send, 'subscription confirmed').to.have.been.called.once();

        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.UNSUBSCRIBED);
            expect(msg[1]).to.equal(2345);
          }
        );
        gate.handle(cli, [WAMP.UNSUBSCRIBE, 2345, subscriptionId]);
        expect(sender.send, 'unsubscription confirmed').to.have.been.called.once();
    });

    it('cleanup Topic API', function () {
      var subSpy = chai.spy(function () {});
      api.substopic('topic1', subSpy);
      expect(api.cleanupTrace(realm.push)).to.equal(1);
      expect(api.cleanupTrace(realm.push)).to.equal(0);
      expect(subSpy).to.not.have.been.called();
    });

    it('PUBLISH default exclude_me:true', function () {
      var subSpy = chai.spy(function () {});
      api.substopic('topic1', subSpy);
      api.publish('topic1', [], {});
      expect(subSpy).to.not.have.been.called();
    });

    it('PUBLISH exclude_me:false', function () {
      var subSpy = chai.spy(function () {});
      api.substopic('topic1', subSpy);
      api.publish('topic1', [], {}, {exclude_me:false});
      expect(subSpy).to.have.been.called.once();
    });

    it('PUBLISH to pattern', function () {
      var subSpy = chai.spy(function (a,b,c,d) {
//        console.log('Publish Event', a,b,c,d);
      });
      api.substopic('topic1.*.item', subSpy);
      api.publish('topic1.123.item', [], {}, {exclude_me:false});
      expect(subSpy).to.have.been.called.once();
    });

    it('PUBLISH to remote', function () {
        var subscriptionId = null;

        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.SUBSCRIBED);
            expect(msg[1]).to.equal(1234);
            subscriptionId = msg[2];
          }
        );
        gate.handle(cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1']);
        expect(sender.send, 'subscription confirmed').to.have.been.called.once();

        sender.send = chai.spy(
          function (msg, callback) {
            expect(msg[0]).to.equal(WAMP.EVENT);
            expect(msg[1]).to.equal(subscriptionId);
            // 2 published message Id
            expect(msg[3]).to.deep.equal({topic:'topic1'});
            expect(msg[4]).to.deep.equal(['arg.1','arg.2']);
            expect(msg[5]).to.deep.equal({foo:'bar'});
          }
        );
        api.publish('topic1', ['arg.1','arg.2'], {foo:'bar'});
        expect(sender.send, 'publication received').to.have.been.called.once();
    });

    it('SUBSCRIBE-to-remote', function () {
      var subSpy = chai.spy(
        function (publicationId, args, kwargs) {
          expect(args).to.deep.equal(['arg.1','arg.2']);
          expect(kwargs).to.deep.equal({foo:'bar'});
        }
      );
      var subId = api.substopic('topic1', subSpy);

      sender.send = chai.spy(
        function (msg, callback) {
          expect(msg[0]).to.equal(WAMP.PUBLISHED);
          expect(msg[1]).to.equal(2345);
        }
      );
      gate.handle(cli, [WAMP.PUBLISH, 1234, {}, "topic1", ['arg.1','arg.2'],{foo:'bar'}]);
      expect(sender.send, 'published').to.not.have.been.called();
      gate.handle(cli, [WAMP.PUBLISH, 2345, {acknowledge:true}, "topic1", ['arg.1','arg.2'],{foo:'bar'}]);
      expect(sender.send, 'published').to.have.been.called.once();

      expect(subSpy, 'publication done').to.have.been.called.twice;
      expect(api.unsubstopic(subId)).to.equal('topic1');
    });
  });

  describe('STORAGE', function() {
    it('retain-get', function (done) {
      var subSpy = chai.spy(function () {});
      api.substopic('topic1', subSpy);
      api.publish('topic1', [], {data:'retain-the-value'}, {retain:100});
      api.publish('topic1', [], {data:'the-value-does-not-retain'});

      let counter = 2;
      sender.send = chai.spy(
        (msg, callback) => {
//          console.log('MSG', counter, msg);
          if (counter == 2) {
            expect(msg[0]).to.equal(WAMP.SUBSCRIBED);
            expect(msg[1]).to.equal(1234);
          }
          else {
            expect(msg[0]).to.equal(WAMP.EVENT);
            expect(msg[5]).to.deep.equal({data:'retain-the-value'});
          }
          --counter;
          if (!counter)
            done();
        }
      );
      gate.handle(cli, [WAMP.SUBSCRIBE, 1234, {}, 'topic1']);
    });

    it('retain-weak', function () {
      gate.handle(cli, [WAMP.PUBLISH, 1234, {retain:0, weak:'public'}, "topic2", ['arg.1','arg.2'],{}]);
//      console.log('key', realm.getKey('topic2'));
      realm.cleanupSession(cli);
//      console.log('key', realm.getKey('topic2'));
    });
  });

});
