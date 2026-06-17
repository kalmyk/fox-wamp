import * as chai from 'chai'
const { expect } = chai

import {
  countWildcards,
  extractUrlValues,
  mergeUrlAndBodyPayload
} from '../lib/sqlite/schema_repository'

describe('URL Field Extraction', function () {
  describe('countWildcards', () => {
    it('counts single wildcard in pattern', () => {
      const count = countWildcards('app.*.data')
      expect(count).to.equal(1)
    })

    it('counts multiple wildcards in order', () => {
      const count = countWildcards('sales.*.*.reports')
      expect(count).to.equal(2)
    })

    it('returns zero if no wildcards', () => {
      const count = countWildcards('app.data.reports')
      expect(count).to.equal(0)
    })

    it('does not count # as a primary key wildcard', () => {
      const count = countWildcards('app.*.data.#')
      expect(count).to.equal(1)
    })
  })

  describe('extractUrlValues', () => {
    it('extracts values from URL using wildcard positions', () => {
      const values = extractUrlValues('app.acme.data', 'app.*.data', ['customer'])
      expect(values).to.deep.equal({ customer: 'acme' })
    })

    it('extracts multiple values from URL by wildcard order', () => {
      const values = extractUrlValues(
        'sales.us.2026-06-16.reports',
        'sales.*.*.reports',
        ['region', 'date']
      )
      expect(values).to.deep.equal({ region: 'us', date: '2026-06-16' })
    })

    it('returns null if URL length does not match pattern', () => {
      const values = extractUrlValues('app.data', 'app.*.data.detail', ['customer'])
      expect(values).to.be.null
    })

    it('returns null if literal parts do not match', () => {
      const values = extractUrlValues('app.acme.detail', 'app.*.data', ['customer'])
      expect(values).to.be.null
    })

    it('handles literal matches correctly with wildcards', () => {
      const values = extractUrlValues('app.acme.sales', 'app.*.sales', ['customer'])
      expect(values).to.deep.equal({ customer: 'acme' })
    })

    it('preserves field names from primary_key array order', () => {
      const values = extractUrlValues(
        'x.first.second.y',
        'x.*.*.y',
        ['fieldOne', 'fieldTwo']
      )
      expect(values).to.deep.equal({ fieldOne: 'first', fieldTwo: 'second' })
    })
  })

  describe('mergeUrlAndBodyPayload', () => {
    it('merges URL values with body payload', () => {
      const urlValues = { customer: 'acme', date: '2026-06-16' }
      const bodyPayload = { amount: 100 }
      const merged = mergeUrlAndBodyPayload(urlValues, bodyPayload)
      expect(merged).to.deep.equal({
        customer: 'acme',
        date: '2026-06-16',
        amount: 100
      })
    })

    it('URL values take precedence over body values', () => {
      const urlValues = { customer: 'acme' }
      const bodyPayload = { customer: 'wrong', amount: 100 }
      const merged = mergeUrlAndBodyPayload(urlValues, bodyPayload)
      expect(merged).to.deep.equal({
        customer: 'acme',
        amount: 100
      })
    })

    it('handles undefined body payload', () => {
      const urlValues = { customer: 'acme' }
      const merged = mergeUrlAndBodyPayload(urlValues, undefined)
      expect(merged).to.deep.equal({ customer: 'acme' })
    })

    it('handles null body payload', () => {
      const urlValues = { customer: 'acme' }
      const merged = mergeUrlAndBodyPayload(urlValues, null)
      expect(merged).to.deep.equal({ customer: 'acme' })
    })
  })
})
