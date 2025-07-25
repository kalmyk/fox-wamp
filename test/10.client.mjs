import chai, { expect, assert } from 'chai'
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import { RESULT_OK, RESULT_ACK, RESULT_EMIT, RESULT_ERR, REQUEST_EVENT, REQUEST_TASK } from '../lib/messages.js'
import { HyperSocketFormatter, HyperApiContext, HyperClient, RemoteHyperClient } from '../lib/hyper/client.js'

describe('10.clent', function () {
  let
    realmAdapterMock,
    clientFormater,
    client,
    remoteClient,
    result,
    ctx

  beforeEach(() => {
    result = []
    realmAdapterMock = { hyperPkgWrite: chai.spy(
      (command) => result.push(command)
    )}
    clientFormater = new HyperSocketFormatter(realmAdapterMock)
    ctx = new HyperApiContext()
    client = new HyperClient(
      clientFormater,
      ctx
    )
    remoteClient = new RemoteHyperClient(clientFormater)
  })

  afterEach(() => {
    clientFormater = null
    client = null
  })

  it('create ECHO command', async () => {
    const responsePromise = client.echo(1234)
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'ECHO',
      id: 1,
      data: { kv: 1234 }
    })

    clientFormater.onMessage({
      rsp: RESULT_OK,
      data: { kv: 'echo-pkg' },
      id: 1
    })

    await assert.becomes(responsePromise, 'echo-pkg')
  })

  it('create SUBSCRIBE command', async () => {
    const onEvent = chai.spy((msg, opt) => result.push([msg, opt]))

    const responsePromise = client.subscribe('function.name', onEvent, {some: 'option'})
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'TRACE',
      uri: ['function','name'],
      id: 1,
      opt: {some: 'option'}
    })

    clientFormater.onMessage({
      rsp: RESULT_ACK,
      qid: 'server-subscription-id',
      id: 1
    })

    await assert.becomes(responsePromise, 'server-subscription-id')

    clientFormater.onMessage({
      rsp: REQUEST_EVENT,
      uri: ['queue','name'],
      data: { kv: 'event-pkg' },
      id: 1,
      qid: 1234567,
      sid: 67890
    })

    // TODO: where is publication-id in opt?
    expect(result.shift()).to.deep.equal([
      'event-pkg',
      {topic: 'queue.name', publication: 1234567, publisher: 67890, headers: undefined}
    ])
  })

  it('create UNSUBSCRIBE command', async () => {
    client.unsubscribe('sub-id')
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'UNTRACE',
      id: 1,
      unr: 'sub-id'
    })
  })

  it('create-PUB-confirm', async () => {
    const responsePromise = client.publish(
      'queue.name',
      { attr1: 1, attr2: 'value' },
      { some: 'option', acknowledge: true, headers: {h1:'ut1'} }
    )
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'PUSH',
      uri: ['queue', 'name'],
      opt: { some: 'option', exclude_me: true },
      hdr: {h1:'ut1'},
      id: 1,
      ack: true,
      data: { kv: { attr1: 1, attr2: 'value' } }
    })

    clientFormater.onMessage({
      rsp: RESULT_ACK,
      qid: 'publication-id',
      id: 1
    })

    await assert.becomes(responsePromise, 'publication-id')
  })

  it('create-PUB-no-confirm', async () => {
    const responsePromise = client.publish(
      'queue.name',
      { attr1: 1, attr2: 'value' },
      { some: 'option' }
    )
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'PUSH',
      uri: ['queue', 'name'],
      opt: { some: 'option', exclude_me: true },
      hdr: {},
      id: 1,
      ack: false,
      data: { kv: { attr1: 1, attr2: 'value' } }
    })

    await assert.isFulfilled(responsePromise)
  })

  it('create-PUSH-no-opt', function () {
    client.publish('function.queue.name', { key: 'val' })
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'PUSH',
      uri: ['function', 'queue', 'name'],
      opt: { exclude_me: true },
      hdr: {},
      id: 1,
      ack: false,
      data: { kv: { key: 'val' } }
    })
  })

  it('create REGISTER command', async () => {
    const onTask = chai.spy((task, opt) => {
      if (task == 'task-fail-on-error') {
        throw new Error(task)
      }
      result.push([task, opt.procedure])
      return 'task-result'
    })

    const registrationPromise = client.register('function.name', onTask, {some: 'option'})
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'REG',
      uri: ['function','name'],
      id: 1,
      opt: {some: 'option'}
    })

    clientFormater.onMessage({
      rsp: RESULT_ACK,
      qid: 'registration-id',
      id: 1
    })

    await assert.becomes(registrationPromise, 'registration-id')

    clientFormater.onMessage({
      rsp: REQUEST_TASK,
      uri: ['function','name'],
      data: { kv: 'task-request-pkg' },
      qid: 'task-id',
      id: 1
    })

    expect(result.shift()).to.deep.equal([
      'task-request-pkg',
      'function.name'
    ])

    // request for task comes to client, and client fails at that task
    clientFormater.onMessage({
      rsp: REQUEST_TASK,
      uri: ['function','name'],
      data: { kv: 'task-fail-on-error' },
      qid: 'task-id',
      id: 1
    })

    // realm is notified that task was failed
    expect(result.shift()).to.deep.equal({
      ft: 'YIELD',
      err: 'error.callee_failure',
      qid: 'task-id',
      data: 'task-fail-on-error',
      rqt: 'ERR'
    })

    // expect(result.shift()).to.deep.equal([
    //   'task-result',
    //   undefined
    // ])
  })

  it('create UNREGISTER command', async () => {
    client.unregister('reg-id')
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'UNREG',
      id: 1,
      unr: 'reg-id'
    })
  })

  it('create CALL done', async () => {
    const progressInfo = []
    const progressFunc = chai.spy((attr, opt) => {progressInfo.push([attr, opt])})
    const responsePromise = client.callrpc(
      'function.name',
      { attr1: 1, attr2: 'value' },
      {some: 'opt', progress: progressFunc}
    )
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'CALL',
      uri: ['function','name'],
      id: 1,
      data: { kv: { attr1: 1, attr2: 'value' } },
      opt: {some: 'opt'}
    })

    clientFormater.onMessage({
      rsp: RESULT_EMIT,
      data: { kv: 'progress-package' },
      id: 1
    })
    expect(progressFunc).called.once()
    expect(progressInfo.shift()).to.deep.equal([
      'progress-package',
      undefined // TODO: get opt
    ])

    clientFormater.onMessage({
      rsp: RESULT_OK,
      data: { kv: 'call-response-package' },
      id: 1
    })

    await assert.becomes(responsePromise, 'call-response-package')
  })

  it('create CALL failed', async () => {
    const responsePromise = client.callrpc(
      'function.name',
      { attr1: 'value' }
    )
    expect(realmAdapterMock.hyperPkgWrite).called.once()
    expect(result.shift()).to.deep.equal({
      ft: 'CALL',
      uri: ['function','name'],
      id: 1,
      data: { kv: { attr1: 'value' } },
      opt: {}
    })

    clientFormater.onMessage({
      rsp: RESULT_ERR,
      data: 'error-text',
      id: 1
    })

    await assert.isRejected(responsePromise, 'error-text')
  })

  it('onopen callbacks and call them on applyOnOpen', async  () => {
    const cb1 = chai.spy()
    const cb2 = chai.spy()    
    remoteClient.onopen(cb1)
    remoteClient.onopen(cb2)
    await remoteClient.applyOnOpen()
    expect(cb1).called.once()
    expect(cb2).called.once()
  })

  // it('should call sendCommand on login', async function () {
  //   const loginData = { user: 'test', pass: '123' }
  //   const promise = remoteClient.login(loginData)
  //   // Simulate a successful login response
  //   const resolve = fakeFormatter.sendCommand.firstCall.args[0].resolve
  //   resolve('ok')
  //   const result = await promise
  //   assert.strictEqual(result, 'ok')
  //   assert(fakeFormatter.sendCommand.calledOnce)
  //   assert.deepStrictEqual(fakeFormatter.sendCommand.firstCall.args[1], { ft: 'LOGIN', data: loginData })
  // })  
})
