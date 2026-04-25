import * as chai from 'chai'
const { expect } = chai;
const assert: Chai.AssertStatic = chai.assert;
import spies from 'chai-spies'
chai.use(spies)

import { KPQueue } from '../lib/masterfree/kpqueue'

interface DeferredObject<T> {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: any) => void;
}

function Deferred<T>(): DeferredObject<T> {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: any) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('04.kpqueue', function () {
  let queue: KPQueue;

  beforeEach(() => {
    queue = new KPQueue()
  });

  afterEach(() => {
    chai.spy.restore()
    queue = null as any
  });

  it('should process a single item', async () => {
    const cb = (chai as any).spy(() => Promise.resolve('done'))
    const result = await queue.enQueue('uri1', cb)
    expect(result).to.equal('done')
    expect(cb).called.exactly(1)
  })

  it('should queue tasks for the same uri and process them sequentially', async () => {
    const task1 = Deferred<string>()
    const callOrder: string[] = []

    const cb1 = (chai as any).spy(() => {
      callOrder.push('cb1')
      return task1.promise
    });
    const cb2 = (chai as any).spy(() => {
      callOrder.push('cb2')
      return Promise.resolve('done2')
    });

    const promise1 = queue.enQueue('uri1', cb1);
    const promise2 = queue.enQueue('uri1', cb2);

    // only the first callback that assosiated with task1 should have been called
    expect(callOrder).to.deep.equal(['cb1']);
    expect(cb1).called.exactly(1);
    expect(cb2).to.not.have.been.called();

    // finish task and start next in queue
    task1.resolve('done1');
    const res1 = await promise1;
    expect(res1).to.equal('done1');

    // Now the second callback should have been called
    expect(callOrder).to.deep.equal(['cb1', 'cb2']);
    expect(cb2).called.exactly(1);

    const res2 = await promise2;
    expect(res2).to.equal('done2');
  });

  it('should process tasks for different uris in parallel', async () => {
    const task1 = Deferred<string>();
    const task2 = Deferred<string>();
    const callOrder: string[] = [];

    const cb1 = (chai as any).spy(() => {
      callOrder.push('cb1');
      return task1.promise;
    });
    const cb2 = (chai as any).spy(() => {
      callOrder.push('cb2');
      return task2.promise;
    });

    const promise1 = queue.enQueue('uri1', cb1);
    const promise2 = queue.enQueue('uri2', cb2);

    // Both should have been called without waiting for the other to finish
    expect(callOrder).to.deep.equal(['cb1', 'cb2']);
    expect(cb1).called.exactly(1);
    expect(cb2).called.exactly(1);

    task1.resolve('done1');
    task2.resolve('done2');

    const [res1, res2] = await Promise.all([promise1, promise2]);

    expect(res1).to.equal('done1');
    expect(res2).to.equal('done2');
  });

  it('should handle promise rejection and continue processing', async () => {
    const callOrder: string[] = [];
    const cb1 = chai.spy(async () => {
      callOrder.push('cb1');
      throw new Error('failed');
    });
    const cb2 = chai.spy(async () => {
      callOrder.push('cb2');
      return 'done2';
    });

    expect(queue.size).to.equal(0);
    const p1 = queue.enQueue('uri1', cb1);
    const p2 = queue.enQueue('uri1', cb2);
    expect(queue.hasKey('uri1')).to.be.true;

    let rejected = false;
    try {
      await p1;
    } catch (e: any) {
      rejected = true;
      expect(e.message).to.equal('failed');
    }

    const res2 = await p2;

    expect(rejected).to.be.true;
    expect(res2).to.equal('done2');
    expect(callOrder).to.deep.equal(['cb1', 'cb2']);
    expect(queue.size).to.equal(0);
  });
});
