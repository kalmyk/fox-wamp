import * as crypto from 'crypto';

export function randomId(): number {
  return crypto.randomBytes(6).readUIntBE(0, 6);
}
