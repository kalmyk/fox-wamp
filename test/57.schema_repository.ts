import * as chai from 'chai'
import promised from 'chai-as-promised'
const { expect } = chai
chai.use(promised)

import sqlite3 from 'sqlite3'
import * as sqlite from 'sqlite'

import { SchemaRepository, createSchemaTables, generateCreateTableSql } from '../lib/sqlite/schema_repository'
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
    const schema = { properties: { a: 'string' }, primary_key: ['a'] }
    await repo.register('schema1', 'app.topic.*', schema)
    await repo.register('schema2', 'other.topic.#', schema)
    
    const found1 = await repo.findByUrl('app.topic.foo')
    expect(found1?.label).to.equal('schema1')
    
    const found2 = await repo.findByUrl('other.topic.bar.baz')
    expect(found2?.label).to.equal('schema2')
    
    const notFound = await repo.findByUrl('app.other.topic')
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
