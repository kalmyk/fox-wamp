import * as chai from 'chai'
const { expect } = chai

import {
  parseUrlPatternFields,
  extractUrlValues,
  mergeUrlAndBodyPayload,
  matchUrlPattern
} from '../lib/sqlite/schema_repository'
import { defaultParse } from '../lib/topic_pattern'

describe('URL Field Extraction', function () {
  describe('parseUrlPatternFields', () => {
    it('extracts field names from URL pattern', () => {
      const fields = parseUrlPatternFields('app.{customer}.data')
      expect(fields).to.deep.equal(['customer'])
    })

    it('extracts multiple field names in order', () => {
      const fields = parseUrlPatternFields('sales.{region}.{date}.reports')
      expect(fields).to.deep.equal(['region', 'date'])
    })

    it('returns empty array if no placeholders', () => {
      const fields = parseUrlPatternFields('app.data.reports')
      expect(fields).to.deep.equal([])
    })

    it('ignores malformed placeholders', () => {
      const fields = parseUrlPatternFields('app.{customer}.data.invalid{order')
      expect(fields).to.deep.equal(['customer'])
    })
  })

  describe('extractUrlValues', () => {
    it('extracts values from URL using pattern placeholders', () => {
      const values = extractUrlValues('app.acme.data', 'app.{customer}.data')
      expect(values).to.deep.equal({ customer: 'acme' })
    })

    it('extracts multiple values from URL', () => {
      const values = extractUrlValues(
        'sales.us.2026-06-16.reports',
        'sales.{region}.{date}.reports'
      )
      expect(values).to.deep.equal({ region: 'us', date: '2026-06-16' })
    })

    it('returns null if URL length does not match pattern', () => {
      const values = extractUrlValues('app.data', 'app.{customer}.data.detail')
      expect(values).to.be.null
    })

    it('returns null if literal parts do not match', () => {
      const values = extractUrlValues('app.acme.detail', 'app.{customer}.data')
      expect(values).to.be.null
    })

    it('handles literal matches correctly', () => {
      const values = extractUrlValues('app.acme.sales', 'app.{customer}.sales')
      expect(values).to.deep.equal({ customer: 'acme' })
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

  describe('matchUrlPattern', () => {
    it('matches URL against pattern with placeholders', () => {
      const url = defaultParse('app.acme.data')
      const pattern = defaultParse('app.{customer}.data')
      expect(matchUrlPattern(url, pattern)).to.be.true
    })

    it('matches multiple placeholders', () => {
      const url = defaultParse('sales.us.2026-06-16.reports')
      const pattern = defaultParse('sales.{region}.{date}.reports')
      expect(matchUrlPattern(url, pattern)).to.be.true
    })

    it('rejects URL with wrong length', () => {
      const url = defaultParse('app.data')
      const pattern = defaultParse('app.{customer}.data.detail')
      expect(matchUrlPattern(url, pattern)).to.be.false
    })

    it('rejects URL with mismatched literals', () => {
      const url = defaultParse('app.acme.detail')
      const pattern = defaultParse('app.{customer}.data')
      expect(matchUrlPattern(url, pattern)).to.be.false
    })

    it('matches when all parts are placeholders', () => {
      const url = defaultParse('acme.value1.value2')
      const pattern = defaultParse('{a}.{b}.{c}')
      expect(matchUrlPattern(url, pattern)).to.be.true
    })

    it('rejects when no placeholders and values differ', () => {
      const url = defaultParse('app.data.reports')
      const pattern = defaultParse('app.data.different')
      expect(matchUrlPattern(url, pattern)).to.be.false
    })
  })
})
