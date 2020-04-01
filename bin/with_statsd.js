//
// This is a basic router example with sonnectivity to the statsd server
//

const Router = require('../index')
const program = require('commander')
const StatsD = require('../ext/statsd')

StatsD.init(program)

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

console.log('Listening port:', program.port)

let app = new Router()
StatsD.traceRouter(app)

app.listenWAMP({ port: program.port })
