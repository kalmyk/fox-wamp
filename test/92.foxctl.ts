import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)
import * as net from 'net'
import * as sqlite from 'sqlite'
import sqlite3 from 'sqlite3'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { spawn } from 'child_process'

import { OneDbRouter } from '../lib/mono/onedbrouter'
import { DbFactory } from '../lib/sqlite/dbfactory'
import { StorageRegistry } from '../lib/sqlite/storage_registry'
import { AdminEvent } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'
import { BaseRealm } from '../lib/realm'

const TEST_PORT = 19735
const REALM = 'testrealm'
const PROJECT_ROOT = path.resolve(__dirname, '..')
const CTL_TIMEOUT = 12000

const CUSTOMER_SCHEMA = {
  properties: { id: 'string', name: 'string' },
  primary_key: ['id'],
  url_pattern: 'customer.*'
}

type CtlResult = { stdout: string; stderr: string; status: number }

function parseJsonOutput(stdout: string): any {
  const line = stdout.split('\n').find(l => l.trim().startsWith('[') || l.trim().startsWith('{'))
  if (!line) throw new SyntaxError(`No JSON found in output:\n${stdout}`)
  return JSON.parse(line.trim())
}

function ctl(...args: string[]): Promise<CtlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'tsx',
      ['bin/foxctl.ts', '--port', String(TEST_PORT), '--realm', REALM, ...args],
      { cwd: PROJECT_ROOT }
    )
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(`foxctl timed out: tsx ${args.join(' ')}`))
    }, CTL_TIMEOUT)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout, stderr, status: code ?? 1 })
    })
  })
}

function ctlRaw(extraArgs: string[], globalArgs: string[]): Promise<CtlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('tsx', ['bin/foxctl.ts', ...globalArgs, ...extraArgs], { cwd: PROJECT_ROOT })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr.on('data', (d: Buffer) => { stderr += d.toString() })
    const timer = setTimeout(() => { child.kill(); reject(new Error('foxctl timed out')) }, CTL_TIMEOUT)
    child.on('close', (code) => { clearTimeout(timer); resolve({ stdout, stderr, status: code ?? 1 }) })
  })
}

function writeSchemaFile(obj: object): string {
  const file = path.join(os.tmpdir(), `fox-test-schema-${process.pid}.json`)
  fs.writeFileSync(file, JSON.stringify(obj))
  return file
}

describe('92.foxctl', function (this: any) {
  this.timeout(30000)

  let db: sqlite.Database
  let router: OneDbRouter
  let realm: BaseRealm
  let api: HyperClient
  let server: net.Server

  beforeEach(async () => {
    db = await sqlite.open({ filename: ':memory:', driver: sqlite3.Database })
    const dbFactory = new DbFactory('/tmp/foxctl-test.db')
    dbFactory.setMainDb(db)
    router = new OneDbRouter(dbFactory)
    realm = await router.getRealm(REALM)
    api = realm.api() as HyperClient
    server = router.listenHyperNet({ port: TEST_PORT }) as net.Server
    await new Promise<void>(resolve => server.once('listening', resolve))
  })

  afterEach(async () => {
    await api.session().cleanup()
    await new Promise<void>(resolve => server.close(() => resolve()))
  })

  it('8.1 schema add registers a schema; schema list returns it', async () => {
    const schemaFile = writeSchemaFile(CUSTOMER_SCHEMA)
    try {
      const addOut = await ctl('schema', 'add', 'customer', schemaFile)
      expect(addOut.status, addOut.stderr).to.equal(0)
      expect(addOut.stdout).to.match(/Registered:/)

      const listOut = await ctl('schema', 'list')
      expect(listOut.status).to.equal(0)
      expect(listOut.stdout).to.include('customer')
    } finally {
      fs.unlinkSync(schemaFile)
    }
  })

  it('8.2 kv list on empty realm returns empty table', async () => {
    const out = await ctl('kv', 'list')
    expect(out.status, out.stderr).to.equal(0)
    expect(out.stdout).to.include('(empty)')
  })

  it('8.3 kv activate returns refreshing; kv list eventually shows online', async () => {
    const schemaResult: any = await api.callrpc(AdminEvent.SCHEMA_ADD, {
      label: 'customer', urlPattern: 'customer.*', schema: CUSTOMER_SCHEMA
    })
    const registry = new StorageRegistry(db, REALM, router.getMakeId())
    await registry.register({ name: 'cust-proj', uriPattern: 'customer.*', schemaId: schemaResult.schemaId })

    const activateOut = await ctl('kv', 'activate', 'cust-proj')
    expect(activateOut.status, activateOut.stderr).to.equal(0)
    expect(activateOut.stdout).to.include('refreshing')

    let status = 'refreshing'
    for (let i = 0; i < 10 && status === 'refreshing'; i++) {
      await new Promise(r => setTimeout(r, 100))
      const listOut = await ctl('--json', 'kv', 'list')
      const storages = parseJsonOutput(listOut.stdout)
      const proj = storages.find((s: any) => s.name === 'cust-proj')
      status = proj?.status ?? 'unknown'
      if (status === 'failed') throw new Error(`Projection failed: ${proj?.lastError}`)
    }
    expect(status).to.equal('online')
  })

  it('8.4 kv activate --wait exits 0 and prints online', async () => {
    const schemaResult: any = await api.callrpc(AdminEvent.SCHEMA_ADD, {
      label: 'customer', urlPattern: 'customer.*', schema: CUSTOMER_SCHEMA
    })
    const registry = new StorageRegistry(db, REALM, router.getMakeId())
    await registry.register({ name: 'cust-wait', uriPattern: 'customer.*', schemaId: schemaResult.schemaId })

    const out = await ctl('kv', 'activate', 'cust-wait', '--wait')
    expect(out.status, `stderr: ${out.stderr}\nstdout: ${out.stdout}`).to.equal(0)
    expect(out.stdout + out.stderr).to.include('online')
  })

  it('8.5 kv reset returns projection to inactive', async () => {
    const schemaResult: any = await api.callrpc(AdminEvent.SCHEMA_ADD, {
      label: 'customer', urlPattern: 'customer.*', schema: CUSTOMER_SCHEMA
    })
    const registry = new StorageRegistry(db, REALM, router.getMakeId())
    await registry.register({ name: 'cust-reset', uriPattern: 'customer.*', schemaId: schemaResult.schemaId })
    await ctl('kv', 'activate', 'cust-reset', '--wait')

    const resetOut = await ctl('kv', 'reset', 'cust-reset')
    expect(resetOut.status, resetOut.stderr).to.equal(0)

    const listOut = await ctl('--json', 'kv', 'list')
    const storages = parseJsonOutput(listOut.stdout)
    const proj = storages.find((s: any) => s.name === 'cust-reset')
    expect(proj?.status).to.equal('inactive')
  })

  it('8.6 --json produces valid JSON for kv list and schema list', async () => {
    await api.callrpc(AdminEvent.SCHEMA_ADD, {
      label: 'customer', urlPattern: 'customer.*', schema: CUSTOMER_SCHEMA
    })

    const kvOut = await ctl('--json', 'kv', 'list')
    expect(kvOut.status, kvOut.stderr).to.equal(0)
    const kvData = parseJsonOutput(kvOut.stdout)
    expect(kvData).to.be.an('array')

    const schemaOut = await ctl('--json', 'schema', 'list')
    expect(schemaOut.status, schemaOut.stderr).to.equal(0)
    const schemaData = parseJsonOutput(schemaOut.stdout)
    expect(schemaData).to.be.an('array').with.lengthOf(1)
    expect(schemaData[0].label).to.equal('customer')
  })

  it('8.7 missing --realm option → error on stderr, exit 1', async () => {
    const out = await ctlRaw(['kv', 'list'], ['--port', String(TEST_PORT)])
    expect(out.status).to.equal(1)
    expect(out.stderr).to.include('--realm')
  })

  it('8.8 server not running → connection error on stderr, exit 1', async () => {
    const out = await ctlRaw(['kv', 'list'], ['--port', '19736', '--realm', REALM])
    expect(out.status).to.equal(1)
    expect(out.stderr).to.include('Error')
  })
})
