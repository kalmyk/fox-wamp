import * as chai from 'chai';
const { expect } = chai;
import { validateSchema } from '../lib/schema_validation';

describe('59.schema_structural_validation', () => {
  it('validates basic valid schema', () => {
    const schema = {
      properties: { id: 'string' },
      primary_key: ['id']
    };
    expect(() => validateSchema(schema)).to.not.throw();
  });

  it('rejects invalid sum structure', () => {
    const schema = {
      properties: { val: 'number', id: 'string' },
      primary_key: ['id'],
      sum: 'not-an-object'
    };
    expect(() => validateSchema(schema)).to.throw('Schema "sum" must be an object');

    const schema2 = {
      properties: { val: 'number', id: 'string' },
      primary_key: ['id'],
      sum: { total: 123 }
    };
    expect(() => validateSchema(schema2)).to.throw('Schema sum field "total" must be a string');
  });

  it('rejects sum source field not in properties', () => {
    const schema = {
      properties: { id: 'string' },
      primary_key: ['id'],
      sum: { total: 'missing' }
    };
    expect(() => validateSchema(schema)).to.throw('Schema sum source field "missing" must be defined in properties');
  });

  it('accepts valid sum structure', () => {
    const schema = {
      properties: { amount: 'number', id: 'string' },
      primary_key: ['id'],
      sum: { total: 'amount' }
    };
    expect(() => validateSchema(schema)).to.not.throw();
  });

  it('rejects invalid propagate structure', () => {
    const schema = {
      properties: { id: 'string' },
      primary_key: ['id'],
      propagate: 'not-an-object'
    };
    expect(() => validateSchema(schema)).to.throw('Schema "propagate" must be an object');

    const schema2 = {
      properties: { id: 'string' },
      primary_key: ['id'],
      propagate: { target: 'not-an-array' }
    };
    expect(() => validateSchema(schema2)).to.throw('Schema propagate rules for "target" must be an array');
  });

  it('rejects invalid propagate rule', () => {
    const schema = {
      properties: { id: 'string' },
      primary_key: ['id'],
      propagate: { target: [null] }
    };
    expect(() => validateSchema(schema)).to.throw('Schema propagate rule in "target" must be an object');

    const schema2 = {
      properties: { id: 'string' },
      primary_key: ['id'],
      propagate: { target: [{}] }
    };
    expect(() => validateSchema(schema2)).to.throw('Schema propagate rule in "target" must have a non-empty "key" array');
  });

  it('accepts valid propagate structure', () => {
    const schema = {
      properties: { id: 'string', val: 'number' },
      primary_key: ['id'],
      propagate: {
        detail: [{
          key: ['id'],
          fields: { total: 'val' }
        }]
      }
    };
    expect(() => validateSchema(schema)).to.not.throw();
  });
});
