#!/usr/bin/env node
import { Command } from 'commander'
import * as fs from 'fs'
import { HyperNetClient } from '../lib/hyper/net_transport'
import { AdminEvent } from '../lib/masterfree/hyper.h'

// ── global option parsing ───────────────────────────────────────────

const program = new Command()
program
  .option('--host <host>', 'server host', 'localhost')
  .option('--port <port>', 'server port', '1735')
  .option('--realm <realm>', 'realm name')
  .option('--json', 'JSON output')
  .allowUnknownOption(true)
  .parse(process.argv)

// parseOptions captures flags (like --wait) that were swallowed by allowUnknownOption
const _parsed = (program as any).parseOptions(process.argv.slice(2))

const globalOpts = program as any

function getHost(): string { return globalOpts.host || 'localhost' }
function getPort(): number { return parseInt(globalOpts.port || '1735') }
function getRealm(): string {
  if (!globalOpts.realm) {
    process.stderr.write('Error: --realm <realm> is required\n')
    process.exit(1)
  }
  return globalOpts.realm
}
function isJson(): boolean { return !!globalOpts.json }

// ── connection helpers ──────────────────────────────────────────────

async function withAdminRealm(realm: string, fn: (client: HyperNetClient) => Promise<void>): Promise<void> {
  const client = new HyperNetClient({ host: getHost(), port: getPort(), maxReconnectAttempts: 0 })

  await new Promise<void>((resolve, reject) => {
    client.getSocket().once('error', reject)

    client.onopen(async () => {
      try {
        await client.login({ realm })
        await fn(client)
        resolve()
      } catch (e) {
        reject(e)
      } finally {
        client.close()
      }
    })

    client.connect()
  })
}

async function withAdmin(fn: (client: HyperNetClient) => Promise<void>): Promise<void> {
  return withAdminRealm(getRealm(), fn)
}

function runCommand(fn: (client: HyperNetClient) => Promise<void>): void {
  withAdmin(fn).then(() => {
    process.exit(0)
  }).catch((err: any) => {
    process.stderr.write('Error: ' + (err.message || String(err)) + '\n')
    process.exit(1)
  })
}

function runCommandWithRealm(realm: string, fn: (client: HyperNetClient) => Promise<void>): void {
  withAdminRealm(realm, fn).then(() => {
    process.exit(0)
  }).catch((err: any) => {
    process.stderr.write('Error: ' + (err.message || String(err)) + '\n')
    process.exit(1)
  })
}

// ── output helpers ──────────────────────────────────────────────────

function printTable(rows: Record<string, any>[], columns: string[]): void {
  if (rows.length === 0) {
    console.log('(empty)')
    return
  }
  const widths = columns.map(col => col.length)
  for (const row of rows) {
    columns.forEach((col, i) => {
      const val = String(row[col] ?? '')
      if (val.length > widths[i]) widths[i] = val.length
    })
  }
  const sep = '+' + widths.map(w => '-'.repeat(w + 2)).join('+') + '+'
  const header = '|' + columns.map((col, i) => ` ${col.padEnd(widths[i])} `).join('|') + '|'
  console.log(sep)
  console.log(header)
  console.log(sep)
  for (const row of rows) {
    const line = '|' + columns.map((col, i) => {
      const val = String(row[col] ?? '')
      return ` ${val.padEnd(widths[i])} `
    }).join('|') + '|'
    console.log(line)
  }
  console.log(sep)
}

// ── command dispatch ────────────────────────────────────────────────

// Combine positional args with unknown flags (e.g. --wait) that commander swallowed
const subArgs: string[] = [...(_parsed.args || []), ...(_parsed.unknown || [])]
const [group, subCmd, ...rest] = subArgs

function makeSubProgram(): InstanceType<typeof Command> {
  const p = new Command()
  p.allowUnknownOption(false)
  return p
}

// ── kv commands ─────────────────────────────────────────────────────

function runKv(args: string[]): void {
  const kv = makeSubProgram()

  kv.command('list')
    .description('list KV projections for a realm')
    .action(() => runCommand(async (client) => {
      const result: any = await client.callrpc(AdminEvent.KV_LIST, {})
      const storages: any[] = result.storages || []
      if (isJson()) {
        console.log(JSON.stringify(storages))
      } else {
        printTable(
          storages.map((s: any) => ({
            name: s.name,
            status: s.status,
            current_position: s.currentPosition ?? '',
            last_error: s.lastError ?? '',
          })),
          ['name', 'status', 'current_position', 'last_error']
        )
      }
    }))

  kv.command('activate <name>')
    .description('activate a KV projection')
    .option('--wait', 'poll until online or failed')
    .action((name: string, cmdObj: any) => {
      const waitFlag = cmdObj.wait
      runCommand(async (client) => {
        const result: any = await client.callrpc(AdminEvent.KV_ACTIVATE, { name })

        if (waitFlag) {
          let status: string = result.status
          while (status === 'refreshing') {
            await new Promise(r => setTimeout(r, 2000))
            const listResult: any = await client.callrpc(AdminEvent.KV_LIST, {})
            const rec = (listResult.storages || []).find((s: any) => s.name === name)
            status = rec ? rec.status : 'unknown'
          }
          if (status === 'online') {
            console.log(`${name} is online`)
          } else {
            process.stderr.write(`${name} ended with status: ${status}\n`)
            process.exit(1)
          }
        } else {
          console.log(`Activation started: ${name} → ${result.status}`)
          console.log(`Track progress: foxctl --realm ${getRealm()} kv list`)
        }
      })
    })

  kv.command('reset <name>')
    .description('reset a KV projection to inactive')
    .action((name: string) => runCommand(async (client) => {
      await client.callrpc(AdminEvent.KV_RESET, { name })
      console.log(`${name} reset to inactive`)
    }))

  kv.parse(['node', 'kv', subCmd, ...rest].filter(Boolean))
}

// ── schema commands ─────────────────────────────────────────────────

function runSchema(args: string[]): void {
  const schema = makeSubProgram()

  schema.command('list')
    .description('list schemas for a realm')
    .action(() => runCommand(async (client) => {
      const result: any = await client.callrpc(AdminEvent.SCHEMA_LIST, {})
      const schemas: any[] = result.schemas || []
      if (isJson()) {
        console.log(JSON.stringify(schemas))
      } else {
        printTable(
          schemas.map((s: any) => ({
            schema_id: s.schemaId,
            label: s.label,
            url_pattern: s.urlPattern,
            data_table: s.dataTable,
            status: s.status,
          })),
          ['schema_id', 'label', 'url_pattern', 'data_table', 'status']
        )
      }
    }))

  schema.command('add <label> <file>')
    .description('register a schema from a JSON file')
    .option('--url-pattern <pattern>', 'URL pattern (overrides schema body field)')
    .action((label: string, file: string, cmdObj: any) => {
      const urlPatternOverride = cmdObj.urlPattern
      runCommand(async (client) => {
        let schemaJson: any
        try {
          schemaJson = JSON.parse(fs.readFileSync(file, 'utf-8'))
        } catch (e: any) {
          process.stderr.write(`Error reading schema file: ${e.message}\n`)
          process.exit(1)
        }
        const urlPattern: string = urlPatternOverride || schemaJson.url_pattern
        if (!urlPattern) {
          process.stderr.write('Error: url_pattern required (in schema file or via --url-pattern)\n')
          process.exit(1)
        }
        const result: any = await client.callrpc(AdminEvent.SCHEMA_ADD, { label, urlPattern, schema: schemaJson })
        console.log(`Registered: ${result.schemaId} → table ${result.dataTable}`)
      })
    })

  schema.command('drop <schema-id>')
    .description('deprecate a schema (rejects if active projections depend on it)')
    .action((schemaId: string) => runCommand(async (client) => {
      await client.callrpc(AdminEvent.SCHEMA_DROP, { schemaId })
      console.log(`${schemaId} deprecated, data table dropped`)
    }))

  schema.parse(['node', 'schema', subCmd, ...rest].filter(Boolean))
}

// ── segment commands ────────────────────────────────────────────────

function runSegment(): void {
  const segment = makeSubProgram()

  segment.command('list')
    .description('list segments for a realm')
    .action(() => runCommand(async (client) => {
      const result: any = await client.callrpc(AdminEvent.SEGMENT_LIST, {})
      const segments: any[] = result.segments || []
      if (isJson()) {
        console.log(JSON.stringify(segments))
      } else {
        printTable(
          segments.map((s: any) => ({
            advance_owner: s.advanceOwner,
            advance_stamp: s.advanceStamp,
            shard_tag: s.shardTag ?? '',
            segment_id: s.segmentId ?? '',
            msg_count: s.msgCount ?? '',
            crc32: s.crc32 ?? '',
            status: s.status,
          })),
          ['advance_owner', 'advance_stamp', 'shard_tag', 'segment_id', 'msg_count', 'crc32', 'status']
        )
      }
    }))

  segment.parse(['node', 'segment', subCmd, ...rest].filter(Boolean))
}

// ── event commands ──────────────────────────────────────────────────

function runEventShardList(): void {
  const realm = globalOpts.realm || 'sys'
  runCommandWithRealm(realm, async (client) => {
    const result: any = await client.callrpc(AdminEvent.EVENT_SHARD_LIST, {})
    const schemas: any[] = result.schemas || []
    if (isJson()) {
      console.log(JSON.stringify(schemas))
    } else {
      const rows: Record<string, any>[] = []
      for (const s of schemas) {
        for (const sh of s.shards || []) {
          rows.push({
            schema: s.schemaName,
            shard: sh.bucket,
            node: sh.nodeId,
            host: sh.host,
            port: sh.port,
          })
        }
      }
      printTable(rows, ['schema', 'shard', 'node', 'host', 'port'])
    }
  })
}

// ── entry point ─────────────────────────────────────────────────────

if (!group || group === '--help' || group === '-h') {
  console.log('Usage: foxctl [options] <kv|schema|segment|event> <subcommand> [args...]')
  console.log('')
  console.log('Global options:')
  console.log('  --host <host>    server host (default: localhost)')
  console.log('  --port <port>    server port (default: 1735)')
  console.log('  --realm <realm>  realm name (required for kv/schema/segment; defaults to sys for event)')
  console.log('  --json           JSON output')
  console.log('')
  console.log('Commands:')
  console.log('  kv list                        list KV projections')
  console.log('  kv activate <name> [--wait]    activate a KV projection')
  console.log('  kv reset <name>                reset a KV projection')
  console.log('  schema list                    list schemas')
  console.log('  schema add <label> <file>      register a schema')
  console.log('  schema drop <schema-id>        deprecate a schema')
  console.log('  segment list                   list advance segments')
  console.log('  event shard list               list event shard allocation')
  process.exit(0)
} else if (group === 'kv') {
  runKv([subCmd, ...rest])
} else if (group === 'schema') {
  runSchema([subCmd, ...rest])
} else if (group === 'segment') {
  runSegment()
} else if (group === 'event') {
  if (subCmd === 'shard' && rest[0] === 'list') {
    runEventShardList()
  } else {
    process.stderr.write(`Unknown event subcommand: ${subCmd} ${rest.join(' ')}\nUse: foxctl event shard list\n`)
    process.exit(1)
  }
} else {
  process.stderr.write(`Unknown command group: ${group}\nUse: foxctl kv|schema|event ...\n`)
  process.exit(1)
}
