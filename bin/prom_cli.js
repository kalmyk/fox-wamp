//
// This is a basic router example with prometheus endpoint exposure
//

const Router = require('../index')
const program = require('commander')
const PromStats = require('../ext/promstats')

PromStats.init(program)

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

console.log('Listening port:', program.port)

let app = new Router()
PromStats.traceRouter(app)

app.listenWAMP({ port: program.port })
