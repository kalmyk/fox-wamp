import * as chai from 'chai'; const { expect } = chai

import { WireSegmentCommittedSource, WireLink } from '../lib/masterfree/wire_segment_source'
import { SegmentCommittedSource, SEGMENT_COMMITTED, CommittedSegmentEvent } from '../lib/masterfree/segment_types'
import { BODY_SEGMENT_COMMITTED } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'

class FakeLink implements WireLink {
  private handlers: Array<(body: BODY_SEGMENT_COMMITTED) => void> = []
  private callbacks: Array<() => void> = []
  private connected = false

  constructor (readonly name: string, connected = true) {
    this.connected = connected
  }

  isConnected (): boolean { return this.connected }
  onSegmentCommitted (handler: (body: BODY_SEGMENT_COMMITTED) => void): void { this.handlers.push(handler) }
  onStateChange (cb: () => void): void { this.callbacks.push(cb) }
  getClient (): HyperClient | undefined { return this.connected ? ({ name: this.name } as any) : undefined }

  deliver (body: BODY_SEGMENT_COMMITTED): void { for (const h of this.handlers) h(body) }
  setConnected (value: boolean): void {
    this.connected = value
    for (const cb of this.callbacks) cb()
  }
}

function seg (segment: string, events: Array<[string, string]>): BODY_SEGMENT_COMMITTED {
  return {
    origin: 'NDB1',
    advanceOwner: 'e1',
    advanceStamp: 1,
    segment,
    events: events.map(([realm, eventId]) => ({ eventId, realm, uri: ['t'], data: { kv: eventId }, opt: {}, sid: 's', shard: 0 }))
  }
}

function collect (source: WireSegmentCommittedSource): CommittedSegmentEvent[] {
  const received: CommittedSegmentEvent[] = []
  source.on(SEGMENT_COMMITTED, (event) => received.push(event))
  return received
}

const ids = (received: CommittedSegmentEvent[]): string[] => received.flatMap(e => e.events.map(r => r.eventId))

describe('75.wire_segment_source', function () {
  const warnings: string[] = []
  const warn = (msg: string) => { warnings.push(msg) }

  beforeEach(() => { warnings.length = 0 })

  it('2.1 satisfies SegmentCommittedSource, so it is a drop-in feed for ProjectionListener', () => {
    // compile-time check: this assignment does not type-check unless the interface is satisfied
    const source: SegmentCommittedSource = new WireSegmentCommittedSource([new FakeLink('E1')], warn)
    expect(source.on).to.be.a('function')
  })

  describe('active/standby', () => {
    it('2.2 forwards only the active link\'s deliveries and discards standby deliveries', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const source = new WireSegmentCommittedSource([a, b], warn)
      const received = collect(source)

      expect(source.getActiveLinkName()).to.equal('E1')
      b.deliver(seg('s1', [['r', 's1a1']]))
      a.deliver(seg('s2', [['r', 's2a1']]))

      expect(ids(received)).to.deep.equal(['s2a1'])
    })

    it('2.2 standby deliveries are dropped, not queued for later', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const source = new WireSegmentCommittedSource([a, b], warn)
      const received = collect(source)

      b.deliver(seg('s1', [['r', 's1a1']]))
      a.setConnected(false) // promotes b
      expect(ids(received)).to.deep.equal([]) // nothing was queued, so nothing is flushed on promotion
    })

    it('2.2 with no connected link nothing is forwarded until one connects', () => {
      const a = new FakeLink('E1', false)
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('s1', [['r', 's1a1']]))
      expect(received).to.have.length(0)
      expect(source.getActiveClient()).to.equal(undefined)

      a.setConnected(true)
      expect(source.getActiveLinkName()).to.equal('E1')
      a.deliver(seg('s2', [['r', 's2a1']]))
      expect(ids(received)).to.deep.equal(['s2a1'])
    })

    it('2.3 promotes the first still-connected standby when the active link drops', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const c = new FakeLink('E3')
      const source = new WireSegmentCommittedSource([a, b, c], warn)
      const received = collect(source)

      b.setConnected(false) // a standby dropping changes nothing
      expect(source.getActiveLinkName()).to.equal('E1')

      a.setConnected(false)
      expect(source.getActiveLinkName()).to.equal('E3') // b is down, so c is the first connected standby
      expect((source.getActiveClient() as any).name).to.equal('E3')

      b.deliver(seg('s1', [['r', 's1a1']]))
      c.deliver(seg('s2', [['r', 's2a1']]))
      expect(ids(received)).to.deep.equal(['s2a1'])
    })

    it('2.3 a link that comes back stays standby until the active link drops', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const source = new WireSegmentCommittedSource([a, b], warn)
      const received = collect(source)

      a.setConnected(false)
      expect(source.getActiveLinkName()).to.equal('E2')
      a.setConnected(true)
      expect(source.getActiveLinkName()).to.equal('E2') // no preemption

      a.deliver(seg('s1', [['r', 's1a1']]))
      b.deliver(seg('s2', [['r', 's2a1']]))
      expect(ids(received)).to.deep.equal(['s2a1'])
    })

    // add-kv-node-topology Decision 6: a lagging standby redelivering an older segment after the
    // active source already delivered a newer one must not reach the projection.
    it('2.4 an older segment redelivered by a standby after a newer one was applied is dropped', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const source = new WireSegmentCommittedSource([a, b], warn)
      const received = collect(source)

      a.deliver(seg('s2', [['r', 's2a1']]))
      b.deliver(seg('s1', [['r', 's1a1']])) // standby lags behind, delivers the older segment

      expect(ids(received)).to.deep.equal(['s2a1'])
    })

    it('2.4 the same regression cannot arrive after a promotion either', () => {
      const a = new FakeLink('E1')
      const b = new FakeLink('E2')
      const source = new WireSegmentCommittedSource([a, b], warn)
      const received = collect(source)

      a.deliver(seg('s2', [['r', 's2a1']]))
      a.setConnected(false) // b takes over, still replaying from its older position
      b.deliver(seg('s1', [['r', 's1a1']]))
      b.deliver(seg('s3', [['r', 's3a1']]))

      expect(ids(received)).to.deep.equal(['s2a1', 's3a1'])
    })
  })

  describe('interim cross-shard ordering guard', () => {
    it('2.5 drops an out-of-order record on a single connection and keeps later ones', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']])) // fast shard
      a.deliver(seg('E050', [['r', 'E050a1']])) // slow shard, logically earlier
      a.deliver(seg('E200', [['r', 'E200a1']]))

      expect(ids(received)).to.deep.equal(['E100a1', 'E200a1'])
      expect(warnings).to.have.length(1)
      expect(warnings[0]).to.include('E050a1')
    })

    it('2.5 tracks each realm separately: an old id for a realm not yet seen is kept', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']]))
      a.deliver(seg('E050', [['other', 'E050a1']]))

      expect(ids(received)).to.deep.equal(['E100a1', 'E050a1'])
    })

    it('2.5 filters stale records out of a mixed batch, keeping the rest', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']]))
      a.deliver(seg('E110', [['r', 'E060a1'], ['q', 'E110a1']]))

      expect(ids(received)).to.deep.equal(['E100a1', 'E110a1'])
      expect(received[1].events.map(e => e.realm)).to.deep.equal(['q'])
    })

    it('2.5 drops a delivery whose records are all stale, so its segment cannot move a watermark backwards', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']]))
      a.deliver(seg('E050', [['r', 'E050a1']]))

      expect(received).to.have.length(1)
    })

    it('2.5 drops an exact duplicate, e.g. a replicated shard broadcasting the same segment twice', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']]))
      a.deliver(seg('E100', [['r', 'E100a1']]))

      expect(ids(received)).to.deep.equal(['E100a1'])
    })

    it('2.5 an empty acknowledgement is forwarded only when its segment is newer than the last one forwarded', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E100', [['r', 'E100a1']]))
      a.deliver(seg('E050', []))
      a.deliver(seg('E150', []))

      expect(received.map(e => e.segment)).to.deep.equal(['E100', 'E150'])
    })

    it('2.5 guard state stays one entry per realm regardless of event volume', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      const realms = ['r1', 'r2', 'r3']
      for (let i = 1; i <= 5000; i++) {
        const id = 'e' + String(i).padStart(6, '0')
        a.deliver(seg(id, [[realms[i % 3], id + 'a1']]))
      }

      expect(received).to.have.length(5000)
      expect((source as any).highWater.size).to.equal(3)
    })

    it('2.5a seedHighWater raises a realm\'s mark, so a record below it is dropped and one above it is kept', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      source.seedHighWater('r', 'E200a1')
      a.deliver(seg('E150', [['r', 'E150a1']]))
      a.deliver(seg('E250', [['r', 'E250a1']]))

      expect(ids(received)).to.deep.equal(['E250a1'])
    })

    it('2.5a seedHighWater never lowers an existing mark and ignores a null position', () => {
      const a = new FakeLink('E1')
      const source = new WireSegmentCommittedSource([a], warn)
      const received = collect(source)

      a.deliver(seg('E300', [['r', 'E300a1']]))
      source.seedHighWater('r', 'E100a1')
      source.seedHighWater('r', null)
      a.deliver(seg('E200', [['r', 'E200a1']]))

      expect(ids(received)).to.deep.equal(['E300a1'])
    })
  })
})
