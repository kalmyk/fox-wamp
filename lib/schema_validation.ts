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
