'use strict'

const chai = require('chai')
const expect = chai.expect

const TopicPattern = require('../lib/topic_pattern')

function match (topic, pattern, result) {
  expect(TopicPattern.mqttMatch(topic, pattern), "match('" + topic + "', '" + pattern + "')").to.equal(true)
  expect(TopicPattern.mqttExtract(topic, pattern), "match('" + topic + "', '" + pattern + "')").to.deep.equal(result)
}

function mis (topic, pattern) {
  expect(TopicPattern.mqttMatch(topic, pattern), "mis('" + topic + "', '" + pattern + "')").to.equal(false)
  expect(TopicPattern.mqttExtract(topic, pattern), "mis('" + topic + "', '" + pattern + "')").to.deep.equal(null)
}

describe('01. topic pattern', function () {
  it('mqtt trivial matching/mismatching', function () {
    match('test/123', 'test/123', [])

    mis('foo', 'bar')
    mis('foo', 'FOO')
    mis('foo/bar', 'foo/bar/baz')
    mis('test/foo/bar', 'test/nope/bar')

    match('foo', 'foo', [])
    match('foo/bar', 'foo/bar', [])
    match('foo/BAR', 'foo/BAR', [])

    mis('test/test/test', 'test/test')
    mis('test/test/test/test', 'test/test')
    mis('test/test', 'test/test/test/test')
  })

  it('wildcard # matching/mismatching', function () {
    match('test', '#', ['test'])
    match('test/test', '#', ['test/test'])
    match('test/test/test', '#', ['test/test/test'])
    match('test/test', 'test/#', ['test'])
    match('test/foo/bar', 'test/#', ['foo/bar'])
    match('test/test/test', 'test/test/#', ['test'])
    match('/', '/#', [''])
    match('/test', '/#', ['test'])
    match('/test/', '/#', ['test/'])
    match('/foo/bar', '/#', ['foo/bar'])
    match('test/', 'test/#', [''])
    match('test', 'test/#', [])
    match('foo/bar', 'foo/bar/#', [])

    match('foo/abcd/bar/1234', 'foo/#', ['abcd/bar/1234'])
    match('foo', 'foo/#', [])

    mis('test', '/#')
    mis('test/test', 'foo/#')
    mis('', 'foo/#')
  })

  it('wildcard + matching/mismatching', function () {
    mis('foo', 'foo/+')
    mis('foo', '+/+')
    mis('/foo', '+')

    match('test', '+', ['test'])

    mis('test', '/+')
    mis('test', 'test/+')
    mis('test/test', 'test/test/+')
    mis('test/foo/bar', 'test/+')

    match('/foo', '+/+', ['', 'foo'])
    match('foo/bar', '+/+', ['foo', 'bar'])
    match('foo/bar', 'foo/+', ['bar'])
    match('foo/', 'foo/+', [''])
    match('foo/bar/baz', 'foo/bar/+', ['baz'])
    match('foo/abcd/bar/1234', 'foo/+/bar/+', ['abcd', '1234'])
    match('test/foo/bar/baz', 'test/+/+/baz', ['foo', 'bar'])

    match('test/foo/bar', 'test/+/+', ['foo', 'bar'])
    match('test/foo/bar', 'test/+/bar', ['foo'])
  })

  it('wildcard +/# matching/mismatching', function () {
    mis('fooo/abcd/bar/1234', 'foo/#')
    mis('foo', 'foo/+/#')

    match('foo/bar/baz', '#', ['foo/bar/baz'])
    match('foo/bar', '+/#', ['foo', 'bar'])
    match('foo/bar/', '+/bar/#', ['foo', ''])
    match('foo/bar/', 'foo/+/#', ['bar', ''])
    match('test/test/test', '+/test/#', ['test', 'test'])
    match('test/foo/bar', 'test/+/#', ['foo', 'bar'])
    match('test/foo/bar/baz', 'test/+/#', ['foo', 'bar/baz'])
    match('foo/bar/test', '+/+/#', ['foo', 'bar', 'test'])
    match('foo/bar/baz/test', 'foo/+/+/#', ['bar', 'baz', 'test'])
    match('test', '+/#', ['test'])
    match('foo/bar', 'foo/+/#', ['bar'])
    match('foo/bar/baz', 'foo/+/baz/#', ['bar'])
    match('test/foo/bar/baz', 'test/+/+/baz/#', ['foo', 'bar'])

    mis('test/foo/test', '+/test/#')
    mis('foo/test/test', 'test/+/#')
    mis('foo/test/test/test', 'test/+/+/#')
  })
})
