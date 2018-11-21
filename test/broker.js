/*jshint expr: true */
var
  chai        = require('chai'),
  spies       = require('chai-spies'),
  expect      = chai.expect,
  {RESULT_OK, RESULT_ACK, RESULT_ERR} = require('../lib/messages'),
  Session     = require("../lib/session"),
  errorCodes  = require('../lib/realm_error').errorCodes,
  FoxGate     = require('../lib/hyper/gate'),
  Realm       = require('../lib/realm').Realm,
  Router      = require('../lib/router');

chai.use(spies);

describe('hyper-broker', function() {
  let
    router,
    gate,
    sender,
    realm,
    session;

  beforeEach(function(){
    sender = {};
    router = new Router();
    realm = new Realm(router);
    gate = new FoxGate(router);
    session = new Session(gate, sender, gate.makeSessionId());
    realm.joinSession(session);
  });

  afterEach(function(){
    session.cleanup();
    broker = null;
    session = null;
  });

  it('echo should return OK with sent data', function () {
    var id = 11;
    sender.send = chai.spy(
        function (msg) {
            expect(msg).to.deep.equal({
              rsp: RESULT_OK,
              id: id,
              data: {body:'data package'}
            });
          }
      );

      cmd = {};
      cmd.ft = 'ECHO';
      cmd.id = id;
      cmd.data = {body:'data package'};

      gate.handle(session, cmd);
      expect(sender.send).to.have.been.called.once();
  });

    it('error to unknown task-yield', function () {
      sender.send = chai.spy(
        function (msg) {
          resp = {};
          resp.rsp = RESULT_ERR;
          resp.ft = 'YIELD';
          resp.id = 1234;
          resp.data = {code:103,message: "The defer requested not found"};
          expect(msg).to.deep.equal(resp);
        }
      );

      gate.handle(session, {
        ft: 'YIELD',
        rsp: RESULT_OK,
        qid: 1234,
        data: {body:'data package'}
      });
      expect(sender.send).to.have.been.called.once();
    });

    it('call should return error with no subscribers', function () {
        var id = 12;
        sender.send = chai.spy(
            function (msg) {
              resp = {};
              resp.rsp = RESULT_ERR;
              resp.ft = 'CALL';
              resp.id = id;
              resp.data = {
                code:errorCodes.ERROR_NO_SUCH_PROCEDURE,
                message:"no callee registered for procedure <testQ>"
              };
              expect(msg).to.deep.equal(resp);
            }
        );

        cmd = {};
        cmd.ft = 'CALL';
        cmd.uri = 'testQ';
        cmd.id = id;

        gate.handle(session, cmd);
        expect(sender.send).to.have.been.called.once();
    });

    it('subscribe-unsubscribed', function () {
      let idSub = 11;
      let idUnSub = 12;
      let regSub = {};

      sender.send = chai.spy(
        function (msg) {
          var resp = {};
          if (msg.id == idSub) {
            resp.rsp = RESULT_ACK;
            expect(msg.id).to.equal(idSub);
            regSub = msg.data;
          }
          else {
            resp.rsp = RESULT_OK;
            resp.id = idUnSub;
            expect(msg).to.deep.equal(resp);
          }
        }
      );
      cmd = {};
      cmd.ft = 'REG';
      cmd.uri = 'testQ';
      cmd.id = idSub;

      gate.handle(session, cmd);

      cmd = {};
      cmd.ft = 'UNREG';
      cmd.unr = regSub;
      cmd.id = idUnSub;

      gate.handle(session, cmd);
      expect(sender.send).to.have.been.called.twice();
    });

    it('should-unTrace', function () {
      const idTrace = 11;
      const idUnTrace = 12;
      let regTrace;

      sender.send = chai.spy(
        function (msg) {
          if (msg.id == idTrace) {
            expect(msg.rsp).to.equal(RESULT_ACK);
            expect(msg.id).to.equal(idTrace);
            regTrace = msg.data;
          }
          else {
            expect(msg.rsp).to.equal(RESULT_OK);
            expect(msg.id).to.equal(idUnTrace);
          }
        }
      );
      gate.handle(session, {
        ft: 'TRACE',
        uri: 'testQ',
        id: idTrace
      });

      gate.handle(session, {
        ft: 'UNTRACE',
        unr: regTrace,
        id: idUnTrace
      });
      expect(sender.send).to.have.been.called.twice();
    });

    it('published-confirm', function () {
      const idTrace = 20;
      const idUnTrace = 21;
      const idPush = 22;
      let regTrace;
      let regPush;

      // make realm replicable
      realm.push.actorConfirm = (actor, cmd) => {};

      realm.push.doConfirm = (actor, cmd) => {
        actor.confirm(cmd);
      };

      sender.send = chai.spy((msg) => {
        regTrace = msg.data;
        expect(msg).to.deep.equal({
          id: idTrace,
          rsp: RESULT_ACK,
          data: regTrace
        });
      });

      gate.handle(session, {
        ft: 'TRACE',
        uri: 'testQ',
        id: idTrace
      });
      expect(sender.send).to.have.been.called.once();

      sender.send = chai.spy((msg) => {
        regPush = msg.qid;
        expect(msg).to.deep.equal({
          id: idTrace,
          uri: 'testQ',
          qid: regPush,
          opt: {},
          rsp: 'EVENT',
          data: 'published-data'
        });
      });

      gate.handle(session, {
        ft: 'PUSH',
        uri: 'testQ',
        ack: true,
        data: 'published-data',
        id: idPush
      });
      expect(sender.send).to.have.been.called.once();

      sender.send = chai.spy((msg) => {
        expect(msg).to.deep.equal({
          id: idPush,
          qid: regPush,
          rsp: RESULT_OK,
          data: 'confirm-data'
        });
      });

      gate.handle(session, {
        ft: 'CONFIRM',
        qid: regPush,
        data: 'confirm-data'
      });
      expect(sender.send).to.have.been.called.once();

      sender.send = chai.spy((msg) => {
        expect(msg).to.deep.equal({
          id: idUnTrace,
          rsp: RESULT_OK
        });
      });

      gate.handle(session, {
        ft: 'UNTRACE',
        unr: regTrace,
        id: idUnTrace
      });
      expect(sender.send).to.have.been.called.once();

    });

});
