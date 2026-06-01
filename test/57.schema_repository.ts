import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { 
  SchemaRepository, 
  createSchemaTables, 
  generateCreateTableSql,
  validateSchema,
  validatePayload 
} from '../lib/sqlite/schema_repository'
import { ProduceId } from '../lib/masterfree/makeid'
import { SchemaStatus } from '../lib/types'

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
    
    const record = await repo.register('test-schema', 'app.topic.#', schema)
    
    expect(record.schemaId).to.match(/^msg123[a-z0-9]+$/)
    expect(record.label).to.equal('test-schema')
    expect(record.urlPattern).to.equal('app.topic.#')
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
    await repo.register('schema1', 'app.topic.*', schema1)
    await repo.register('schema2', 'other.topic.#', schema2)
    await repo.loadCache()

    const found1 = repo.findByUrl('app.topic.foo')
    expect(found1?.label).to.equal('schema1')
    
    const found2 = repo.findByUrl('other.topic.bar.baz')
    expect(found2?.label).to.equal('schema2')
    
    const notFound = repo.findByUrl('app.other.topic')
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
    expect(sql).to.contain('CREATE TABLE IF NOT EXISTS my_table')
    expect(sql).to.contain('id TEXT NOT NULL')
    expect(sql).to.contain('count REAL')
    expect(sql).to.contain('tags TEXT')
    expect(sql).to.contain('PRIMARY KEY (id)')
  })
})
