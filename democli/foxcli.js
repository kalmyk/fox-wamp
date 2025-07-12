'use strict'

const { HyperNetClient } = require('../lib/hyper/net_transport')

async function main () {
  const params = {
    host: 'localhost',
    port: 1735
  }

  try {
    const client = new HyperNetClient(params)
    client.onopen(async () => {
      console.log('onopen: Hyper client connected successfully')
      await client.login({realm: 'realm1'})
      console.log('login successful')

      await client.subscribe('com.myapp.topic1', (msg, opt) => {
        console.log('Received message:', msg, 'with options:', opt)
      })
      console.log('Subscribed to com.myapp.topic1')

      await client.publish('com.myapp.topic1', { message: 'Hello, Hyper!' })
      console.log('Published message to com.myapp.topic1')
    })
    await client.connect()
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
