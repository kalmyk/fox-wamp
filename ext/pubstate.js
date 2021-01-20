'use strict'

const NetTransport = require('../lib/hyper/net_transport')

const routerList = {
  a00 : { host: '127.0.0.1', port: 9300 },
  a01 : { host: '127.0.0.1', port: 9301 },
  a02 : { host: '127.0.0.1', port: 9302 },
}

let cntList = {}

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

    for (let routerId in cntList) {
      cntList[routerId].push('takeNewSegment', result)
    }
    task.resolve({})
  })
}

for (let routerId in routerList) {
  const settings = routerList[routerId]
  const connection = new NetTransport.ClientSocket(settings)
  connection.onopen = function (session) {
    cntList[routerId] = session
    worker(session).then(function (value) {
      console.log('worker OK:', value)
    }, function (err) {
      console.error('ERROR:', err, err.stack)
    })
  }
  connection.connect()
}
