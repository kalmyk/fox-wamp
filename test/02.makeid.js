'use strict'

const chai   = require('chai')
const spies  = require('chai-spies')
const expect = chai.expect
const { keyDate, keyId, ProduceId } = require('../lib/masterfree/makeid')

chai.use(spies)

describe('02 make-id', function () {
  let id

  beforeEach(function () {
    id = new ProduceId((a) => a)
  })

  afterEach(function () {
    id = null
  })

  it('format-date', () => {
    expect(keyDate(new Date(Date.UTC(2019, 3, 6, 19, 29, 11, 0)))).to.equal('1904061929')
  })

  it('format-number', () => {
    expect(keyId(123)).to.equal('b3f')
  })

  it('make-some-id', () => {
    id.reconcilePos('test-prefix-')
    expect(id.generateIdStr()).to.equal('test-prefix-a1')
    expect(id.generateIdStr(2)).to.equal('test-prefix-a3')
  })

  it('reconcilePos', function () {
    id.reconcilePos('a')
    expect(id.generateIdStr()).to.equal('aa1')
    id.reconcilePos('a')
    expect(id.generateIdStr()).to.equal('aa2')
    id.reconcilePos('a', 1)
    expect(id.generateIdStr()).to.equal('aa3')
    id.reconcilePos('a', 7)
    expect(id.generateIdStr()).to.equal('aa8')
    id.reconcilePos('b')
    expect(id.generateIdStr()).to.equal('ba1')
    id.reconcilePos('a')
    expect(id.generateIdStr()).to.equal('ba2')
  })
})
