import FoxRouter from '../lib/fox_router'
import program from 'commander'

// eslint-disable-next-line @typescript-eslint/no-var-requires
const PromStats = require('../ext/promstats') as any

PromStats.init(program)

program
  .option('-p, --port <port>', 'Server IP port', '9000')
  .parse(process.argv)

console.log('Listening port:', program.port)

const app = new FoxRouter()
PromStats.traceRouter(app)

app.listenWAMP({ port: program.port })
