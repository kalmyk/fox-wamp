import * as crypto from 'crypto';

export function randomId(): number {
  return crypto.randomBytes(6).readUIntBE(0, 6);
}

/**
 * Extracts a value from WAMP/MQTT/FOX body containers.
 * - WAMP uses {args: [payload]} or {args: [], kwargs: {payload}}
 * - MQTT uses {payload: "JSON"}
 * - FOX internal often uses {kv: payload}
 */
export function getBodyValue(body: any): any {
  if (body === null || body === undefined) {
    return null;
  }
  if (typeof body === 'object') {
    if ('kv' in body)      return body.kv
    if ('payload' in body) return JSON.parse(body.payload)
    if ('args' in body) {
      if (Array.isArray(body.args)) {
        if (body.args.length == 0) return null
        if (body.args.length == 1) return body.args[0]
      }
      return body.args
    }
  }
  const bodyStr = (body && typeof body === 'object' && !Buffer.isBuffer(body)) ? JSON.stringify(body) : String(body)
  throw new Error('unknown body `' + bodyStr + '`')
}
