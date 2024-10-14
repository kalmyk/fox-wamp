'use strict'

const chai = require('chai')
const expect = chai.expect
const assert = chai.assert
const promised = require('chai-as-promised')
chai.use(promised)

const MemTransport = require('../lib/hyper/mem_transport')
const FoxGate      = require('../lib/hyper/gate')
const Router       = require('../lib/router')

describe('23 pub-worker', function () {
  let
    memServer,
    router,
    gate,
    realm,
    client,
    worker

  beforeEach(() => {
    router = new Router()
    realm = router.getRealm('test-realm')
    gate = new FoxGate(router)
    memServer = new MemTransport.MemServer(gate)
    client = memServer.createClient(realm)
    worker = memServer.createClient(realm)
  })

  afterEach(() => {
    assert.isFalse(client.session.hasSendError(), client.session.firstSendErrorMessage())
    assert.isFalse(worker.session.hasSendError(), worker.session.firstSendErrorMessage())

    router = null
    gate = null
    realm = null
    client = null
    worker = null
  })

  it('echo should return OK with sent data', async () => {
    return assert.becomes(
      client.echo('test'),
      'test',
      'echo done'
    )
  })

  it('call to not existed function has to be failed', async () => {
    return assert.isRejected(
      client.callrpc('test.func', { attr1: 1 }),
      /no callee registered for procedure/,
      'callrpc rejected'
    )
  })

  it('remote-procedure-call', async () => {
    await worker.register(
      'test.func', (args) => {
        return Promise.resolve({ result: 'done', args: args })
      }
    )
    await assert.becomes(
      client.callrpc('test.func', { attr1: 1, attr2: 2 }),
      { result: 'done', args: { attr1: 1, attr2: 2 } },
      'callrpc should be processed'
    )
  })

  it('call-progress', async () => {
    await worker.register('test.func',
      (args, opt) => {
        opt.progress([1])
        opt.progress([2])
        return Promise.resolve({ result: 'done', args })
      }
    )
    const resultProgress = []
    await assert.becomes(
      client.callrpc('test.func', { attr1: 1 }, {progress: (info => resultProgress.push(info))}),
      { result: 'done', args: { attr1: 1 } },
      'callrpc should be processed'
    )
    expect(resultProgress.shift()).to.deep.equal([1])
    expect(resultProgress.shift()).to.deep.equal([2])
  })

  it('simultaneous-task-limit', async () => {
    let qArgs = null
    let responseCount = 0

    let regId = await worker.register(
      'func1', (args, opt) => {
        assert.equal(null, qArgs, 'only one task to resolve')
        qArgs = args
        return new Promise((resolve, reject) => {
          process.nextTick(() => {
            responseCount++
            qArgs = null
            resolve(args)
          })
        })
      }
    )

    const resultCollector = []
    for (let i = 1; i <= 7; i++) {
      resultCollector.push(
        client.callrpc('func1', i)
      )
    }
    expect(responseCount).to.equal(0)
    expect(await Promise.all(resultCollector)).to.deep.equal([1,2,3,4,5,6,7])
    expect(responseCount).to.equal(7)

    await assert.becomes(
      worker.unregister(regId),
      undefined,
      'must unregister'
    )
  })

  it('trace-publish-untrace', async () => {
    const publications = []
    let traceSpy = chai.spy((data, opt) => {
      publications.push([data, opt.topic])
    })
    let regTrace = await worker.subscribe('customer', traceSpy, { someOpt: 987 })

    await assert.becomes(
      client.publish('customer', { data1: 'value1' }, { acknowledge: true }),
      undefined, // TODO: publication id
      'publish done'
    )
    expect(traceSpy).to.have.been.called.once()
    expect(publications.shift()).to.deep.equal([{ data1: 'value1' }, 'customer'])

    await assert.becomes(
      worker.unsubscribe(regTrace),
      undefined,
      'unsubscribe done'
    )
  })

})
