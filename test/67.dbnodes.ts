import * as chai from 'chai'; const { expect } = chai

import { Config, parseStoragePattern } from '../lib/masterfree/config'

describe('67.dbnodes', function () {
  describe('Config.getDbNodes() / getDbNodeById() / findStoragePatternsForNode()', () => {
    let config: Config

    beforeEach(() => {
      config = new Config()
      ;(config as any).config = {
        dbNodes: {
          KV1: { host: '127.0.0.1', port: '1765', storage: ['*:#'] },
          KV2: { host: '127.0.0.1', port: '1766', storage: ['myapp:orders.#', 'myapp:users.*'] },
        }
      }
    })

    it('getDbNodes() returns the raw dbNodes map', () => {
      expect(config.getDbNodes()).to.deep.equal({
        KV1: { host: '127.0.0.1', port: '1765', storage: ['*:#'] },
        KV2: { host: '127.0.0.1', port: '1766', storage: ['myapp:orders.#', 'myapp:users.*'] },
      })
    })

    it('getDbNodes() returns undefined when dbNodes missing', () => {
      ;(config as any).config = {}
      expect(config.getDbNodes()).to.equal(undefined)
    })

    it('getDbNodeById() returns the node entry for a known id', () => {
      expect(config.getDbNodeById('KV1')).to.deep.equal({ host: '127.0.0.1', port: '1765', storage: ['*:#'] })
    })

    it('getDbNodeById() throws for an unknown id', () => {
      expect(() => config.getDbNodeById('KV99')).to.throw('not found')
    })

    it('findStoragePatternsForNode() returns patterns for KV1', () => {
      expect(config.findStoragePatternsForNode('KV1')).to.deep.equal(['*:#'])
    })

    it('findStoragePatternsForNode() returns patterns for KV2', () => {
      expect(config.findStoragePatternsForNode('KV2')).to.deep.equal(['myapp:orders.#', 'myapp:users.*'])
    })

    it('findStoragePatternsForNode() returns empty array for unknown node', () => {
      expect(config.findStoragePatternsForNode('KV99')).to.deep.equal([])
    })

    it('findStoragePatternsForNode() returns empty array when dbNodes missing', () => {
      ;(config as any).config = {}
      expect(config.findStoragePatternsForNode('KV1')).to.deep.equal([])
    })
  })

  describe('parseStoragePattern()', () => {
    it('splits an exact realm and single-segment key-pattern', () => {
      expect(parseStoragePattern('myapp:orders')).to.deep.equal({ realm: 'myapp', keyPattern: ['orders'] })
    })

    it('splits a wildcard realm', () => {
      expect(parseStoragePattern('*:orders.created')).to.deep.equal({ realm: '*', keyPattern: ['orders', 'created'] })
    })

    it('parses a multi-segment dotted key-pattern', () => {
      expect(parseStoragePattern('myapp:orders.#')).to.deep.equal({ realm: 'myapp', keyPattern: ['orders', '#'] })
    })

    it('splits only on the first colon', () => {
      // key-pattern segments never contain ':' in practice, but the split must not
      // treat a later ':' specially if one ever appeared.
      expect(parseStoragePattern('myapp:a:b')).to.deep.equal({ realm: 'myapp', keyPattern: ['a:b'] })
    })
  })

  describe('Config.nodeOwnsRealmAndUri()', () => {
    let config: Config

    beforeEach(() => {
      config = new Config()
      ;(config as any).config = {
        dbNodes: {
          KV1: { host: '127.0.0.1', port: '1765', storage: ['myapp:orders.#'] },
          KV2: { host: '127.0.0.1', port: '1766', storage: ['*:users.*'] },
          KV3: { host: '127.0.0.1', port: '1767', storage: ['myapp:orders.#', 'myapp:invoices.*'] },
        }
      }
    })

    it('matches an exact realm and covering key-pattern', () => {
      expect(config.nodeOwnsRealmAndUri('KV1', 'myapp', ['orders', 'created'])).to.equal(true)
    })

    it('matches a wildcard realm', () => {
      expect(config.nodeOwnsRealmAndUri('KV2', 'anyrealm', ['users', 'alice'])).to.equal(true)
    })

    it('does not match a non-matching realm', () => {
      expect(config.nodeOwnsRealmAndUri('KV1', 'otherapp', ['orders', 'created'])).to.equal(false)
    })

    it('does not match a non-covering key-pattern', () => {
      expect(config.nodeOwnsRealmAndUri('KV1', 'myapp', ['users', 'alice'])).to.equal(false)
    })

    it('matches when a node has multiple patterns and only one covers the input', () => {
      expect(config.nodeOwnsRealmAndUri('KV3', 'myapp', ['invoices', 'inv1'])).to.equal(true)
      expect(config.nodeOwnsRealmAndUri('KV3', 'myapp', ['payments', 'p1'])).to.equal(false)
    })

    // 2.3: '*' only matches one segment (equal-length match), '#' matches any depth —
    // this is why the checked-in supervisor/config.json example uses "*:#", not "*:*".
    it('"*:#" covers a multi-segment URI', () => {
      ;(config as any).config.dbNodes.KV4 = { host: '127.0.0.1', port: '1768', storage: ['*:#'] }
      expect(config.nodeOwnsRealmAndUri('KV4', 'anyrealm', ['orders', 'created'])).to.equal(true)
    })

    it('"*:*" does NOT cover a multi-segment URI', () => {
      ;(config as any).config.dbNodes.KV5 = { host: '127.0.0.1', port: '1769', storage: ['*:*'] }
      expect(config.nodeOwnsRealmAndUri('KV5', 'anyrealm', ['orders', 'created'])).to.equal(false)
    })
  })

  describe('Config.validateStorageForNode()', () => {
    let config: Config

    beforeEach(() => {
      config = new Config()
    })

    it('passes for well-formed patterns, including "*:*"', () => {
      ;(config as any).config = { dbNodes: { KV1: { storage: ['*:*', 'myapp:orders.#'] } } }
      expect(() => config.validateStorageForNode('KV1')).to.not.throw()
    })

    it('throws when a pattern has no ":" separator', () => {
      ;(config as any).config = { dbNodes: { KV1: { storage: ['myapp.orders'] } } }
      expect(() => config.validateStorageForNode('KV1')).to.throw('separator')
    })

    it('throws when the realm segment is empty', () => {
      ;(config as any).config = { dbNodes: { KV1: { storage: [':orders.#'] } } }
      expect(() => config.validateStorageForNode('KV1')).to.throw('empty realm')
    })

    it('throws when the key-pattern segment is empty', () => {
      ;(config as any).config = { dbNodes: { KV1: { storage: ['myapp:'] } } }
      expect(() => config.validateStorageForNode('KV1')).to.throw('empty key-pattern')
    })
  })
})
