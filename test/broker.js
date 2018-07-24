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

describe('broker', function() {
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
            resp = {};
            resp.rsp = RESULT_OK;
            resp.ft = 'ECHO';
            resp.id = id;
            resp.data = {body:'data package'};
            expect(msg).to.deep.equal(resp);
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

      cmd = {};
      cmd.ft = 'YIELD';
      cmd.rsp = RESULT_OK;
      cmd.qid = 1234;
      cmd.data = {body:'data package'};

      gate.handle(session, cmd);
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
            expect(msg.ft).to.equal('REG');
            expect(msg.id).to.equal(idSub);
            regSub = msg.data;
          }
          else {
            resp.rsp = RESULT_OK;
            resp.ft = 'UNREG';
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
      let idTrace = 11;
      let idUnTrace = 12;
      let regTrace;

      sender.send = chai.spy(
        function (msg) {
          if (msg.id == idTrace) {
            expect(msg.rsp).to.equal(RESULT_ACK);
            expect(msg.ft).to.equal('TRACE');
            expect(msg.id).to.equal(idTrace);
            regTrace = msg.data;
          }
          else {
            expect(msg.rsp).to.equal(RESULT_OK);
            expect(msg.ft).to.equal('UNTRACE');
            expect(msg.id).to.equal(idUnTrace);
          }
        }
      );
      cmd = {};
      cmd.ft = 'TRACE';
      cmd.uri = 'testQ';
      cmd.id = idTrace;

      gate.handle(session, cmd);

      cmd = {};
      cmd.ft = 'UNTRACE';
      cmd.unr = regTrace;
      cmd.id = idUnTrace;

      gate.handle(session, cmd);
      expect(sender.send).to.have.been.called.twice();
    });
});
