'use strict';

var
  chai     = require('chai'),
  expect   = chai.expect,
  assert   = chai.assert,
  promised = require('chai-as-promised'),
  MemTransport  = require('../lib/hyper/mem_transport'),
  ServerSession = require('../lib/session'),
  QueueClient   = require('../lib/hyper/queueClient'),
  FoxGate       = require("../lib/hyper/gate"),
  Realm         = require("../lib/realm").Realm,
  Router        = require('../lib/router');

chai.use(promised);

describe('pub-worker', function() {
  let
    router,
    gate,
    realm,
    client,
    worker;

  function connect(realm, gate, id) {
    let result = new QueueClient.QueueClient();
    let serverSession = new ServerSession(gate, new MemTransport.Sender(result), id);
    result.sender = new MemTransport.Sender(serverSession);
    serverSession.realm = realm;
    realm.joinSession(serverSession);
    return result;
  }

  beforeEach(function(){
    router = new Router();
    realm = new Realm(router);
    gate = new FoxGate(router);
    client = connect(realm, gate, gate.makeSessionId());
    worker = connect(realm, gate, gate.makeSessionId());
  });

  afterEach(function(){
    router = null;
    gate = null;
    realm = null;
    client = null;
    worker = null;
  });

  it('echo should return OK with sent data', function (done) {
    assert.becomes(
      client.echo('test'),
      'test',
      'echo done'
    ).notify(done);
  });

  it('call to not existed function has to be failed', function (done) {
    assert.isRejected(
      client.call('test.func', {attr1:1, attr2:2}),
      /no callee registered for procedure/,
      'call rejected'
    ).notify(done);
  });

  it('remote-procedure-call', function (done) {
    worker.register(
      'test.func', function(args, task) {
        expect(task.getUri()).to.equal('test.func');
        expect(args).to.deep.equal({attr1:1, attr2:2});
        task.resolve({result:'done'});
    }).then(
      function(result) {
        return assert.becomes(
          client.call('test.func', {attr1:1, attr2:2}),
          {result:'done'},
          'call should be processed'
        ).notify(done);
      },
      function(reason) {
        assert(false, 'unable to register');
      }
    );
  });

  it('call-progress', function (done) {
    worker.register(
      'test.func', function(args, task) {
        expect(task.getUri()).to.equal('test.func');
        expect(args).to.deep.equal({attr1:1, attr2:2});
        task.notify({progress:1});
        task.notify({progress:2});
        task.resolve({result:'done'});
    }).then(
      function(result) {
        return assert.becomes(
          client.call('test.func', {attr1:1, attr2:2}),
          {result:'done'},
          'call should be processed'
        ).notify(done);
      },
      function(reason) {
        assert(false, 'unable to register');
      }
    );
  });

  it('simultaneous-task-limit', function (done) {
    let qTask = null;
    let worker_calls = 0;
    let reg;

    worker.register(
      'func1', function (args, task)
      {
        assert.equal(null, qTask, 'only one task to resolve');
        qTask = task;
        worker_calls++;
        assert.equal(args, worker_calls, 'Task FIFO broken');

        if (worker_calls == 7) {
          assert.becomes(
            worker.unRegister(reg),
            undefined,
            'must unregister'
          );
          done();
        }
        else {
          process.nextTick(function () {
            qTask.resolve('result '+worker_calls);
            qTask = null;
          });
        }
      }
    ).then(function(registration){
      reg = registration;

      var i;
      for (i=1; i<=7; i++)
      {
        client.call('func1', i).then((response) => {
//          console.log('response', response);
        });
      }
    });
  });

  it('omit-tasks-of-terminated-sessions', function (done) {
    let reg;

    worker.register(
      'func1', function (args, task) {
        task.resolve('any-result');
        client.close();
      }
    ).then(function(registration){
      reg = registration;
      client.call('func1', 'call-1').then(() => {
        expect(realm.rpc.getPendingTaskCount()).to.equal(0);
        done();
      });
      client.call('func1', 'call-2').then(() => {
        done();
      });
      client.call('func1', 'call-3');
    });
  });

  it('trace-push-untrace', function () {
    let regTrace;
    let traceSpy = chai.spy(function (data, task) {
      expect(task.getUri()).to.equal('customer');
      task.resolve(null);
    });
    return worker.trace('customer', traceSpy, {someOpt:987}).
      then((trace) => {
          regTrace = trace;
        }).
      then(() => {
        return assert.becomes(
          client.push('customer', {data1:'value1', data2:'value2'}),
          undefined,
          'push done'
        );}).
      then(() => {
        expect(traceSpy).to.have.been.called.once();
        return assert.becomes(
          worker.unTrace(regTrace),
          undefined,
          'unTrace done'
        );
      });
  });

});
