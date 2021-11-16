'use strict'

const chai   = require('chai')
const spies  = require('chai-spies')
const expect = chai.expect
const { keyDate, keyId, MakeId } = require('../lib/allot/makeid')

chai.use(spies)

describe('01. make-id', function () {
  let id

  beforeEach(function () {
    id = new MakeId((a) => a)
  })

  afterEach(function () {
    id = null
  })

  it('format-date', () => {
    expect(keyDate(new Date(2019, 3, 6, 19, 29, 11, 0))).to.equal('1904062329')
  })

  it('format-number', () => {
    expect(keyId(123)).to.equal('b3f')
  })

  it('make-some-id', () => {
    id.update('test-prefix-')
    expect(id.makeIdStr()).to.equal('test-prefix-a1')
    expect(id.makeIdStr(2)).to.equal('test-prefix-a3')
  })

  it('reconcilePos', function () {
    id.update('a')
    expect(id.makeIdStr()).to.equal('aa1')
    id.reconcilePos('a')
    expect(id.makeIdStr()).to.equal('aa2')
    id.reconcilePos('a', 1)
    expect(id.makeIdStr()).to.equal('aa3')
    id.reconcilePos('a', 7)
    expect(id.makeIdStr()).to.equal('aa8')
    id.reconcilePos('b')
    expect(id.makeIdStr()).to.equal('ba1')
    id.reconcilePos('a')
    expect(id.makeIdStr()).to.equal('ba2')
  })
})
