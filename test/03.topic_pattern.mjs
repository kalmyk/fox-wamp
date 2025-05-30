import { expect } from 'chai'

import TopicPattern from '../lib/topic_pattern.js'

function mqttmatch (topic, pattern, result) {
  expect(TopicPattern.mqttMatch(topic, pattern), "mqttmatch('" + topic + "', '" + pattern + "')").to.equal(true)
  expect(TopicPattern.mqttExtract(topic, pattern), "mqttmatch('" + topic + "', '" + pattern + "')").to.deep.equal(result)
  expect(TopicPattern.merge(result,TopicPattern.mqttParse(pattern)),'merge(' + JSON.stringify(result) + ", '" + pattern + "')").to.deep.equal(TopicPattern.mqttParse(topic))
}

function mqttmis (topic, pattern) {
  expect(TopicPattern.mqttMatch(topic, pattern), "mqttmis('" + topic + "', '" + pattern + "')").to.equal(false)
  expect(TopicPattern.mqttExtract(topic, pattern), "mqttmis('" + topic + "', '" + pattern + "')").to.deep.equal(null)
}

describe('03 topic pattern', function () {
  it('base parse', function () {
    expect(TopicPattern.mqttParse('')).to.deep.equal([''])
    expect(TopicPattern.mqttParse('#')).to.deep.equal(['#'])
    expect(TopicPattern.mqttParse('foo')).to.deep.equal(['foo'])
    expect(TopicPattern.mqttParse('foo/bar')).to.deep.equal(['foo','bar'])
    expect(TopicPattern.mqttParse('foo/bar/#')).to.deep.equal(['foo','bar', '#'])

    expect(TopicPattern.match(['foo', 'bar'], ['#'])).to.equal(true)
  })

  it('pattern-intersect', function () {
    expect(TopicPattern.intersect(['*'], ['foo', '*'])).to.equal(false)
    expect(TopicPattern.intersect(['*'], ['foo', '#'])).to.equal(true)
    expect(TopicPattern.intersect(['*', 'bar', '#'], ['foo', '*', 'bar', '#'])).to.equal(true)
    expect(TopicPattern.intersect(['foo', '*', 'bar', '#'], ['foo', '*', 'bar', '#'])).to.equal(true)
    expect(TopicPattern.intersect(['foo', '*', 'baz', '#'], ['foo', '*', 'bar', '#'])).to.equal(false)
  })

  // it('topic-extract', function () {
  //   expect().to.deep.equal(['*', '#'])
  //   console.log('EXTRACT', TopicPattern.extract(['cache', '#'], ['cache', '*', 'name', '#']))
  // })

  it('mqtt trivial matching/mismatching', function () {
    mqttmatch('test/123', 'test/123', [])

    mqttmis('foo', 'bar')
    mqttmis('foo', 'FOO')
    mqttmis('foo/bar', 'foo/bar/baz')
    mqttmis('test/foo/bar', 'test/nope/bar')

    mqttmatch('foo', 'foo', [])
    mqttmatch('foo/bar', 'foo/bar', [])
    mqttmatch('foo/BAR', 'foo/BAR', [])

    mqttmis('test/test/test', 'test/test')
    mqttmis('test/test/test/test', 'test/test')
    mqttmis('test/test', 'test/test/test/test')
  })

  it('wildcard # matching/mismatching', function () {
    mqttmatch('test', '#', ['test'])
    mqttmatch('test/test', '#', ['test', 'test'])
    mqttmatch('test/test/test', '#', ['test', 'test', 'test'])
    mqttmatch('test/test', 'test/#', ['test'])
    mqttmatch('test/foo/bar', 'test/#', ['foo', 'bar'])
    mqttmatch('test/test/test', 'test/test/#', ['test'])
    mqttmatch('/', '/#', [''])
    mqttmatch('/test', '/#', ['test'])
    mqttmatch('/test/', '/#', ['test', ''])
    mqttmatch('/foo/bar', '/#', ['foo', 'bar'])
    mqttmatch('test/', 'test/#', [''])
    mqttmatch('test', 'test/#', [])
    mqttmatch('foo/bar', 'foo/bar/#', [])

    mqttmatch('foo/abcd/bar/1234', 'foo/#', ['abcd', 'bar', '1234'])
    mqttmatch('foo', 'foo/#', [])

    mqttmis('test', '/#')
    mqttmis('test/test', 'foo/#')
    mqttmis('', 'foo/#')
  })

  it('wildcard + matching/mismatching', function () {
    mqttmis('foo', 'foo/+')
    mqttmis('foo', '+/+')
    mqttmis('/foo', '+')

    mqttmatch('test', '+', ['test'])

    mqttmis('test', '/+')
    mqttmis('test', 'test/+')
    mqttmis('test/test', 'test/test/+')
    mqttmis('test/foo/bar', 'test/+')

    mqttmatch('/foo', '+/+', ['', 'foo'])
    mqttmatch('foo/bar', '+/+', ['foo', 'bar'])
    mqttmatch('foo/bar', 'foo/+', ['bar'])
    mqttmatch('foo/', 'foo/+', [''])
    mqttmatch('foo/bar/baz', 'foo/bar/+', ['baz'])
    mqttmatch('foo/abcd/bar/1234', 'foo/+/bar/+', ['abcd', '1234'])
    mqttmatch('test/foo/bar/baz', 'test/+/+/baz', ['foo', 'bar'])

    mqttmatch('test/foo/bar', 'test/+/+', ['foo', 'bar'])
    mqttmatch('test/foo/bar', 'test/+/bar', ['foo'])
  })

  it('wildcard +/# matching/mismatching', function () {
    mqttmis('fooo/abcd/bar/1234', 'foo/#')
    mqttmis('foo', 'foo/+/#')

    mqttmatch('foo/bar/baz', '#', ['foo', 'bar', 'baz'])
    mqttmatch('foo/bar', '+/#', ['foo', 'bar'])
    mqttmatch('foo/bar/', '+/bar/#', ['foo', ''])
    mqttmatch('foo/bar/', 'foo/+/#', ['bar', ''])
    mqttmatch('test/test/test', '+/test/#', ['test', 'test'])
    mqttmatch('test/foo/bar', 'test/+/#', ['foo', 'bar'])
    mqttmatch('test/foo/bar/baz', 'test/+/#', ['foo', 'bar', 'baz'])
    mqttmatch('foo/bar/test', '+/+/#', ['foo', 'bar', 'test'])
    mqttmatch('foo/bar/baz/test', 'foo/+/+/#', ['bar', 'baz', 'test'])
    mqttmatch('test', '+/#', ['test'])
    mqttmatch('foo/bar', 'foo/+/#', ['bar'])
    mqttmatch('foo/bar/baz', 'foo/+/baz/#', ['bar'])
    mqttmatch('test/foo/bar/baz', 'test/+/+/baz/#', ['foo', 'bar'])

    mqttmis('test/foo/test', '+/test/#')
    mqttmis('foo/test/test', 'test/+/#')
    mqttmis('foo/test/test/test', 'test/+/+/#')
  })
})
