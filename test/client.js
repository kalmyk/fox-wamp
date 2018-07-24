/*jshint mocha: true */
/*jshint node: true */
/*jshint expr: true */
'use strict';

var
  QUEUE  = require('../lib/hyper/const.js'),
  chai   = require('chai'),
  spies  = require('chai-spies'),
  expect = chai.expect,
  assert = chai.assert,
  {RESULT_OK, RESULT_ACK, RESULT_EMIT} = require('../lib/messages'),
  ClientBase = require('../lib/hyper/clientBase'),
  QueueClient = require('../lib/hyper/queueClient');

chai.use(spies);

describe('clent', function() {
  var
    sender,
    client,
    expectCommand;

  beforeEach(function(){
    sender = {};
    sender.send = chai.spy(
      function (command) {
        expect(command).to.deep.equal(expectCommand);
      }
    );
    client = new QueueClient.QueueClient();
    client.sender = sender;
  });

  afterEach(function(){
    client = null;
  });

  it('create ECHO command', function () {
    var cmd = {};
    cmd.ft = 'ECHO';
    cmd.id = 1;
    cmd.data = 1234;
    expectCommand = cmd;

    client.echo(1234);
    expect(sender.send).to.have.been.called.once();
  });

  it('create CALL command', function () {
    var cmd = {};
    cmd.ft = 'CALL';
    cmd.uri = 'function.queue.name';
    cmd.id = 1;
    cmd.data = {attr1:1, attr2:'value'};
    expectCommand = cmd;

    client.call('function.queue.name', {attr1:1, attr2:'value'});
    expect(sender.send).to.have.been.called.once();
  });

  it('create PUSH command', function () {
    var cmd = {};
    cmd.ft = 'PUSH';
    cmd.uri = 'function.queue.name';
    cmd.ack = true;
    cmd.opt = {some:'option'};
    cmd.id = 1;
    cmd.data = {attr1:1, attr2:'value'};
    expectCommand = cmd;

    client.push('function.queue.name', {attr1:1, attr2:'value'}, {some:'option'});
    expect(sender.send).to.have.been.called.once();
  });

  it('build trace task', function (done) {
    var trace = chai.spy(function (data, task) {
      expect(task).to.be.instanceof(ClientBase.Task);
      expect(data).to.equal('data');
      //task.resolve();
    });

    var cmd = {};
    cmd.ft = 'TRACE';
    cmd.uri = 'function.queue.name';
    cmd.opt = {some:'option'};
    cmd.id = 1;
    expectCommand = cmd;

    assert.becomes(
      client.trace('function.queue.name', trace, {some:'option'}),
      undefined,
      'trace resolved'
    ).notify(done);

    expect(sender.send).to.have.been.called.once();

    var rsp = {};
    rsp.rsp = RESULT_ACK;
    rsp.id = 1;
    client.handle(rsp);

    var rsp = {};
    rsp.rsp = QUEUE.RES_TASK;
    rsp.id = 1;
    rsp.data = 'data';
    client.handle(rsp);

    expect(trace).to.have.been.called.once();

    // remove subscription
    var rsp = {};
    rsp.rsp = RESULT_OK;
    rsp.id = 1;
    client.handle(rsp);
  });

  it('send Task response', function () {
    var cmd = {};
    cmd.ft = 'YIELD';
    cmd.rsp = RESULT_EMIT;
    cmd.qid = 'generaged.id';
    cmd.data = ['data'];
    expectCommand = cmd;

    var request = {};
    request.qid = 'generaged.id';
    client.sendTaskResponse(request, RESULT_EMIT, ['data']);
    expect(sender.send).to.have.been.called.once();
  });
});
