'use strict'

const { FoxNetClient } = require('../lib/hyper/net_transport')

async function main () {
  const params = {
    host: 'localhost',
    port: 1735
  }

  try {
    const client = new FoxNetClient(params)
    await client.connect()

    console.log('Hyper client connected')

    await client.login({realm: 'realm1'})
    console.log('login successful')

    await client.subscribe('com.myapp.topic1', (msg, opt) => {
      console.log('Received message:', msg, 'with options:', opt)
    })
    console.log('Subscribed to com.myapp.topic1')

    await client.publish('com.myapp.topic1', { message: 'Hello, Hyper!' })

  } catch (err) {
    console.error('Error connecting to Hyper server:', err)
  }
}

main()
  .then(() => {
    console.log('Hyper client main function completed.')
  })
  .catch((err) => {
    console.error('Error in Hyper client main function:', err)
  })
