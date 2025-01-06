'use strict'

const chai        = require('chai')
const spies       = require('chai-spies')
const expect      = chai.expect
const assert      = chai.assert

const { SO_ON_ID_PAIR, SO_EXTRACT, StageOne } = require('../lib/allot/stage_one')

chai.use(spies)

describe('61 allot', function () {
  let
    stageOne,
    extractHistory = []

  beforeEach(() => {
    stageOne = new StageOne(2)
    stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic1', 'a1')
    stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic2', 'a1')
    stageOne.on(SO_EXTRACT, (topic, extract) => {extractHistory.push([topic,extract])})
  })

  afterEach(() => {})

  it('stage-one shiftExpectant', () => {
    stageOne.setRecentValue('a0')
    assert.equal(stageOne.shiftExpectant(), 'a1')
    assert.equal(stageOne.getRecentValue(), 'a1')
  })

  it('stage-one extract', () => {
    stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic2', 'a2')
    assert.deepEqual(extractHistory.shift(), ['topic2','a1'])
    assert.equal(stageOne.getRecentValue(), 'a1')

    // vote for closed topic
    stageOne.emit(SO_ON_ID_PAIR, 'vouter3', 'topic2', 'a3')
    assert.equal(extractHistory.shift(), undefined)
    assert.equal(stageOne.getRecentValue(), 'a2')

    // value is taken from recent vote
    stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic1', 'a2')
    assert.deepEqual(extractHistory.shift(), ['topic1','a3'])
    assert.equal(stageOne.getRecentValue(), 'a3')
  })

})

