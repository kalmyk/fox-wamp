'use strict'

const NetTransport = require('../lib/hyper/net_transport')

const connection = new NetTransport.ClientSocket({
  host: process.env.FC_REALM_HOST || '127.0.0.1',
  port: process.env.FC_REALM_PORT || 9300
})

let maxPrefix = undefined
let maxDate = undefined
let maxSegment = undefined

async function worker (session) {
  const loginDetails = await session.login({})
  console.log('loginDetails', loginDetails)

  await session.trace('getNewSegment', (data, task) => {
    let newPrefix = data.date + data.segment
    if (!maxPrefix || maxPrefix < newPrefix) {
      maxPrefix = newPrefix
      maxDate = data.date
      maxSegment = data.segment
    }

    const result = { date: maxDate, segment: maxSegment }
    console.log('segment', maxPrefix, data, result)

    session.push('takeNewSegment', result)
    task.resolve({})
  })
}

connection.onopen = function (session) {
  worker(session).then(function (value) {
    console.log('worker OK:', value)
  }, function (err) {
    console.error('ERROR:', err, err.stack)
  })
}
connection.connect()
