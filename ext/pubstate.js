'use strict'

const QueueClient  = require('../lib/hyper/queueClient').QueueClient
const NetTransport = require('../lib/hyper/net_transport')

const conf_realm_host = process.env.FC_REALM_HOST || '127.0.0.1'
const conf_realm_port = process.env.FC_REALM_PORT || 9300

let client = new QueueClient()

let socket = NetTransport.createClientSocket(client)
let maxPrefix = undefined
let maxDate = undefined
let maxSegment = undefined

async function worker () {
  await new Promise((resolve, reject) => {
    socket.connect(conf_realm_port, conf_realm_host, function () {
      resolve()
    })
  })

  let loginDetails = await client.login({})
  console.log('loginDetails', loginDetails)

  await client.trace('getNewSegment', (data, task) => {
    let newPrefix = data.date + data.segment
    if (!maxPrefix || maxPrefix < newPrefix) {
      maxPrefix = newPrefix
      maxDate = data.date
      maxSegment = data.segment
    }

    let result = { date: maxDate, segment: maxSegment }
    console.log('segment', maxPrefix, data, result)

    client.push('takeNewSegment', result)
    task.resolve({})
  })
}

worker().then(function (value) {
  console.log('worker OK:', value)
}, function (err) {
  console.error('ERROR:', err, err.stack)
})
