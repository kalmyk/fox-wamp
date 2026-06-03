import { getBodyValue } from './base_gate'

export function getPayload(data: any): any {
  if (data && typeof data === 'object' && 'args' in data && Array.isArray(data.args)) {
    if (data.args.length === 1) return data.args[0]
    if (data.args.length === 0) return null
    return data.args
  }
  return getBodyValue(data)
}

export function validateSchema(schemaJson: any) {
  if (!schemaJson || typeof schemaJson !== 'object') {
    throw new Error('Schema must be an object')
  }
  if (!schemaJson.properties || typeof schemaJson.properties !== 'object') {
    throw new Error('Schema must have a "properties" object')
  }
  if (!Array.isArray(schemaJson.primary_key) || schemaJson.primary_key.length === 0) {
    throw new Error('Schema must have a non-empty "primary_key" array')
  }
  for (const key of schemaJson.primary_key) {
    if (!schemaJson.properties[key]) {
      throw new Error(`Primary key "${key}" must be defined in properties`)
    }
  }

  // Optional sum validation
  if (schemaJson.sum !== undefined) {
    if (typeof schemaJson.sum !== 'object' || schemaJson.sum === null) {
      throw new Error('Schema "sum" must be an object')
    }
    for (const key of Object.keys(schemaJson.sum)) {
      const field = schemaJson.sum[key]
      if (typeof field !== 'string') {
        throw new Error(`Schema sum field "${key}" must be a string (source field name)`)
      }
      if (!schemaJson.properties[field]) {
        throw new Error(`Schema sum source field "${field}" must be defined in properties`)
      }
    }
  }

  // Optional propagate validation
  if (schemaJson.propagate !== undefined) {
    if (typeof schemaJson.propagate !== 'object' || schemaJson.propagate === null) {
      throw new Error('Schema "propagate" must be an object')
    }
    for (const target of Object.keys(schemaJson.propagate)) {
      const rules = schemaJson.propagate[target]
      if (!Array.isArray(rules)) {
        throw new Error(`Schema propagate rules for "${target}" must be an array`)
      }
      for (const rule of rules) {
        if (typeof rule !== 'object' || rule === null) {
          throw new Error(`Schema propagate rule in "${target}" must be an object`)
        }
        if (!Array.isArray(rule.key) || rule.key.length === 0) {
          throw new Error(`Schema propagate rule in "${target}" must have a non-empty "key" array`)
        }
        if (rule.fields !== undefined) {
          if (typeof rule.fields !== 'object' || rule.fields === null) {
            throw new Error(`Schema propagate rule "fields" in "${target}" must be an object`)
          }
        }
      }
    }
  }
}

export function validatePayload(schemaJson: any, payload: any) {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Payload must be an object')
  }
  const props = schemaJson.properties
  for (const key of Object.keys(props)) {
    let expectedType = props[key]
    if (typeof expectedType === 'object' && expectedType !== null) {
      expectedType = expectedType.type
    }
    const val = payload[key]
    if (val === undefined || val === null) {
      if (schemaJson.primary_key.includes(key)) {
        throw new Error(`Primary key field "${key}" is missing or null`)
      }
      continue
    }
    const actualType = typeof val
    if (expectedType === 'number') {
      if (actualType !== 'number') {
        throw new Error(`Field "${key}" expected type "number", got "${actualType}"`)
      }
    } else if (expectedType === 'string') {
      if (actualType !== 'string') {
        throw new Error(`Field "${key}" expected type "string", got "${actualType}"`)
      }
    }
  }
}
