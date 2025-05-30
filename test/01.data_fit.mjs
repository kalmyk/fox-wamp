import { expect } from 'chai'
import { isDataFit } from '../lib/realm.js'

describe('01 isDataFit', function () {
  it('level-one-null', function () {
    expect(isDataFit(null, null)).to.equal(true)
  })

  it('level-one-data-identical', function () {
    expect(isDataFit(1, { kv: 1 })).to.equal(true)
  })
  it('level-one-data-failed', function () {
    expect(isDataFit(1, { kv: 2 })).to.equal(false)
  })
  it('level-two-identical', function () {
    expect(isDataFit({ field1: 1 }, { kv: { field1: '1', field2: 2 } })).to.equal(true)
  })
  it('level-two-failed', function () {
    expect(isDataFit({ field: 1 }, { kv: { field: '2' } })).to.equal(false)
  })
})
