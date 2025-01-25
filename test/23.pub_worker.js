'use strict'

const chai = require('chai')
const expect = chai.expect
const assert = chai.assert
const promised = require('chai-as-promised')
chai.use(promised)

const { MemServer } = require('../lib/hyper/mem_transport')
const { FoxGate }   = require('../lib/hyper/gate')
const Router        = require('../lib/router')

describe('23 pub-worker', () => {
  let
    memServer,
    router,
    gate,
    realm,
    client,
    worker

  const runs = [
    {it: 'remote-api', client: () => memServer.createClient(realm), worker: () => realm.api()},
    {it: 'api-remote', worker: () => memServer.createClient(realm), client: () => realm.api()},
  ]
    
  runs.forEach(function (run) {
    describe('direction:' + run.it, function () {

      beforeEach(() => {
        router = new Router()
        realm = router.getRealm('test_realm')
        gate = new FoxGate(router)
        memServer = new MemServer(gate)
        client = run.client()
        worker = run.worker()
      })

      afterEach(() => {
        assert.isFalse(client.session().hasSendError(), client.session().firstSendErrorMessage())
        assert.isFalse(worker.session().hasSendError(), worker.session().firstSendErrorMessage())

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
        let regId = await worker.register(
          'test.func', (args) => {
            return Promise.resolve({ result: 'done', args: args })
          }
        )
        await assert.becomes(
          client.callrpc('test.func', { attr1: 1, attr2: 2 }),
          { result: 'done', args: { attr1: 1, attr2: 2 } },
          'callrpc should be processed'
        )
        await assert.isFulfilled(
          worker.unregister(regId),
          'unregister should be processed'
        )
      })

      it('call-progress', async () => {
        let regId = await worker.register('test.func',
          (args, opt) => {
            opt.progress('result1')
            opt.progress([2])
            opt.progress({f1:3})
            return Promise.resolve({ result: 'done', args, headers: opt.headers, procedure: opt.procedure })
          }
        )
        const resultProgress = []
        await assert.becomes(
          client.callrpc(
            'test.func',
            { attr1: 1 },
            {
              progress: (info => resultProgress.push(info)),
              headers: {h1:'test'}
            }
          ),
          { result: 'done', args: { attr1: 1 }, headers: {h1:'test'}, procedure: 'test.func' },
          'callrpc should be processed'
        )
        expect(resultProgress.shift()).to.deep.equal('result1')
        expect(resultProgress.shift()).to.deep.equal([2])
        expect(resultProgress.shift()).to.deep.equal({f1:3})

        await assert.isFulfilled(
          worker.unregister(regId),
          'unregister should be processed'
        )
      })

      it('simultaneous-task-limit', async () => {
        let requestCount = 0
        let regId = await worker.register(
          'func1', (args, opt) => {
            requestCount++
            return new Promise((resolve, reject) => {
              process.nextTick(() => {
                resolve([args,requestCount--])            
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
        expect(await Promise.all(resultCollector)).to.deep.equal([[1,1],[2,1],[3,1],[4,1],[5,1],[6,1],[7,1]])
        
        await worker.unregister(regId)
      })

      it('trace-publish-untrace', async () => {
        const publications = []
        let traceSpy = chai.spy((data, opt) => {
          publications.push([data, opt.topic])
        })
        let regTrace = await worker.subscribe('customer', traceSpy, { someOpt: 987 })

        await assert.becomes(
          client.publish('customer', { data1: 'value1' }, { acknowledge: true }),
          null, // TODO: publication id
          'publish done'
        )
        expect(traceSpy).to.have.been.called.once()
        expect(publications.shift()).to.deep.equal([{ data1: 'value1' }, 'customer'])

        await assert.becomes(
          worker.unsubscribe(regTrace),
          null,
          'unsubscribe done'
        )
      })

    })
  })

})
