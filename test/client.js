/*jshint mocha: true */
/*jshint node: true */
/*jshint expr: true */
'use strict';

var
  chai   = require('chai'),
  spies  = require('chai-spies'),
  expect = chai.expect,
  assert = chai.assert,
  {RESULT_OK, RESULT_ACK, RESULT_EMIT, REQUEST_EVENT} = require('../lib/messages'),
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
    expectCommand = {
      ft: 'ECHO',
      id: 1,
      data: { kv: 1234 }
    };
    client.echo(1234);
    expect(sender.send).to.have.been.called.once();
  });

  it('create CALL command', function () {
    expectCommand = {
      ft: 'CALL',
      uri: 'function.queue.name',
      id: 1,
      data: { kv:{attr1:1, attr2:'value'} }
    };
    client.call('function.queue.name', {attr1:1, attr2:'value'});
    expect(sender.send).to.have.been.called.once();
  });

  it('create-PUSH-command', function () {
    expectCommand = {
      ft: 'PUSH',
      uri: 'function.queue.name',
      ack: true,
      opt: {some:'option'},
      id: 1,
      data: { kv: {attr1:1, attr2:'value'} }
    };
    client.push('function.queue.name', {attr1:1, attr2:'value'}, {some:'option'});
    expect(sender.send).to.have.been.called.once();
  });

  it('create-PUSH-no-opt', function () {
    expectCommand = {
      ft: 'PUSH',
      uri: 'function.queue.name',
      ack: true,
      opt: {},
      id: 1,
      data: { kv:{key:'val'} }
    };
    client.push('function.queue.name', {key:'val'});
    expect(sender.send).to.have.been.called.once();
  });

  it('build-trace-task', function (done) {
    let trace = chai.spy(function (data, task) {
      expect(task).to.be.instanceof(ClientBase.Task);
      expect(data).to.equal('task-data');
      task.resolve('task-data-amended');
    });

    expectCommand = {
      ft: 'TRACE',
      uri: 'function.queue.name',
      opt: {some:'option'},
      id: 1 // client generated ID
    };

    assert.becomes(
      client.trace('function.queue.name', trace, {some:'option'}),
      undefined,
      'trace resolved'
    ).notify(done);

    expect(sender.send).to.have.been.called.once();

    // server response that TRACE is SET
    client.handle({
      rsp: RESULT_ACK,
      id: 1
    });

    // server receives confirmation that event processed
    expectCommand = {
      ft: 'CONFIRM',
      rqt: RESULT_OK,
      qid: 'server-generated-trace-id',
      data: {kv:"task-data-amended"}
    };

    // some PUBLISH occurred and data arrived
    client.handle({
      id: 1,
      uri: 'any-text',
      rsp: REQUEST_EVENT,
      qid: 'server-generated-trace-id',
      data: {kv:'task-data'}
    });

    // trace event invoked
    expect(trace).to.have.been.called.once();

    // server decided to remove subscription
    client.handle({
      rsp: RESULT_OK,
      id: 1
    });
  });

  it('send Task response', function () {
    expectCommand = {
      ft: 'YIELD',
      rqt: RESULT_EMIT,
      qid: 'generaged.id',
      data: { kv: {dataKey:'data-value'} }
    };
    var request = {};
    request.id = 'no.meaning.client.task.id';
    request.qid = 'generaged.id';
    client.sendTaskResponse(request, RESULT_EMIT, {dataKey:'data-value'});
    expect(sender.send).to.have.been.called.once();
  });
});
