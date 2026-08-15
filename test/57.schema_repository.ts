import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { 
  SchemaRepository, 
  createSchemaTables, 
  generateCreateTableSql
} from '../lib/sqlite/schema_repository'
import { validateSchema, validatePayload } from '../lib/schema_validation'
import { ProduceId } from '../lib/masterfree/makeid'
import { SchemaStatus } from '../lib/types'
import { defaultParse } from '../lib/topic_pattern'

describe('57.schema_repository', function () {
  let db: sqlite.Database
  let makeId: ProduceId
  let repo: SchemaRepository
  const realmName = 'testrealm'

  beforeEach(async () => {
    db = await sqlite.open({
      filename: ':memory:',
      driver: sqlite3.Database
    })
    
    makeId = new ProduceId(() => 'msg123')
    makeId.actualizePrefix()
    
    await createSchemaTables(db, realmName)
    repo = new SchemaRepository(db, realmName, makeId)
  })

  it('validates schema structure', () => {
    expect(() => validateSchema({})).to.throw('Schema must have a "properties" object')
    expect(() => validateSchema({ properties: {} })).to.throw('Schema must have a non-empty "primary_key" array')
    expect(() => validateSchema({ properties: { a: 'string' }, primary_key: ['b'] }))
      .to.throw('Primary key "b" must be defined in properties')
    
    expect(() => validateSchema({ properties: { a: 'string' }, primary_key: ['a'] })).to.not.throw()
  })

  it('validates payloads against schema', () => {
    const schema = {
      properties: {
        id: 'string',
        val: 'number'
      },
      primary_key: ['id']
    }
    
    expect(() => validatePayload(schema, { id: 'foo', val: 123 })).to.not.throw()
    expect(() => validatePayload(schema, { val: 123 })).to.throw('Primary key field "id" is missing or null')
    expect(() => validatePayload(schema, { id: 123, val: 123 })).to.throw('Field "id" expected type "string", got "number"')
    expect(() => validatePayload(schema, { id: 'foo', val: 'bar' })).to.throw('Field "val" expected type "number", got "string"')
    
    // Optional fields
    const schema2 = {
      properties: { id: 'string', opt: 'number' },
      primary_key: ['id']
    }
    expect(() => validatePayload(schema2, { id: 'foo' })).to.not.throw()
  })

  it('registers a schema and records history', async () => {
    const schema = {
      properties: {
        id: 'string',
        val: 'number'
      },
      primary_key: ['id']
    }

    const record = await repo.register('test-schema', 'app.*.data', schema)

    expect(record.schemaId).to.match(/^sch_testrealm_[a-f0-9]{16}$/)
    expect(record.label).to.equal('test-schema')
    expect(record.urlPattern).to.equal('app.*.data')
    expect(record.status).to.equal(SchemaStatus.Active)
    expect(record.dataTable).to.match(/^data_testrealm_[a-f0-9]{12}$/)

    const saved = await repo.get(record.schemaId)
    expect(saved).to.deep.equal(record)

    const history = await db.all(`SELECT * FROM update_history_${realmName}`)
    expect(history).to.have.lengthOf(1)
    expect(history[0].topic).to.equal(`schema:${record.schemaId}`)
    expect(JSON.parse(history[0].msg_newv)).to.deep.equal(record)
  })

  it('finds schema by matching URL pattern', async () => {
    const schema1 = { properties: { a: 'string' }, primary_key: ['a'] }
    const schema2 = { properties: { b: 'number' }, primary_key: ['b'] }
    await repo.register('schema1', 'app.*.topic', schema1)
    await repo.register('schema2', 'other.*.data', schema2)
    await repo.loadCache()

    const found1 = repo.findByUrl(defaultParse('app.foo.topic'))
    expect(found1?.label).to.equal('schema1')

    const found2 = repo.findByUrl(defaultParse('other.bar.data'))
    expect(found2?.label).to.equal('schema2')
    
    const notFound = repo.findByUrl(defaultParse('unmatched.path.pattern'))
    expect(notFound).to.be.null
  })

  it('generates CREATE TABLE SQL correctly', () => {
    const schema = {
      properties: {
        id: 'string',
        count: 'number',
        tags: 'string'
      },
      primary_key: ['id']
    }
    const sql = generateCreateTableSql('my_table', schema)
    expect(sql).to.contain('CREATE TABLE IF NOT EXISTS "my_table"')
    expect(sql).to.contain('"id" TEXT NOT NULL')
    expect(sql).to.contain('"count" REAL')
    expect(sql).to.contain('"tags" TEXT')
    expect(sql).to.contain('PRIMARY KEY ("id")')
  })

  it('list returns all registered schemas', async () => {
    const schema1 = { properties: { a: 'string' }, primary_key: ['a'] }
    const schema2 = { properties: { b: 'string' }, primary_key: ['b'] }
    const r1 = await repo.register('s1', 'app.*.one', schema1)
    const r2 = await repo.register('s2', 'app.*.two', schema2)

    const all = await repo.list()
    expect(all).to.have.lengthOf(2)
    expect(all.map(s => s.schemaId)).to.include.members([r1.schemaId, r2.schemaId])
  })

  it('deprecate drops data table and marks schema deprecated', async () => {
    const schema = { properties: { id: 'string' }, primary_key: ['id'] }
    const record = await repo.register('to-deprecate', 'app.*.dep', schema)

    const tablesBefore = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [record.dataTable])
    expect(tablesBefore).to.have.lengthOf(1)

    await repo.deprecate(record.schemaId)

    const saved = await repo.get(record.schemaId)
    expect(saved!.status).to.equal(SchemaStatus.Deprecated)

    const tablesAfter = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [record.dataTable])
    expect(tablesAfter).to.have.lengthOf(0)
  })

  it('deprecate is a no-op when schema is already deprecated', async () => {
    const schema = { properties: { id: 'string' }, primary_key: ['id'] }
    const record = await repo.register('already-dep', 'app.*.dep2', schema)

    await repo.deprecate(record.schemaId)
    await repo.deprecate(record.schemaId) // should not throw

    const saved = await repo.get(record.schemaId)
    expect(saved!.status).to.equal(SchemaStatus.Deprecated)
  })

  it('deprecate throws when schema not found', async () => {
    await expect(repo.deprecate('sch_testrealm_nonexistent')).to.be.rejectedWith('Schema not found')
  })

  it('schema replacement leaves new schema untouched after old is deprecated', async () => {
    const schemaV1 = { properties: { id: 'string', val: 'string' }, primary_key: ['id'] }
    const schemaV2 = { properties: { id: 'string', val: 'string', extra: 'string' }, primary_key: ['id'] }

    const v1 = await repo.register('myschema-v1', 'app.*.data', schemaV1)
    const v2 = await repo.register('myschema-v2', 'app.*.v2', schemaV2)

    expect(v1.dataTable).to.not.equal(v2.dataTable)

    await repo.deprecate(v1.schemaId)

    // v1 deprecated and table dropped
    const v1After = await repo.get(v1.schemaId)
    expect(v1After!.status).to.equal(SchemaStatus.Deprecated)
    const v1Table = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [v1.dataTable])
    expect(v1Table).to.have.lengthOf(0)

    // v2 untouched
    const v2After = await repo.get(v2.schemaId)
    expect(v2After!.status).to.equal(SchemaStatus.Active)
    const v2Table = await db.all(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`, [v2.dataTable])
    expect(v2Table).to.have.lengthOf(1)
  })

})
