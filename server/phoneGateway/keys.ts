// Device keys. A key is 32 random bytes, shown to the counselor once. Only its
// SHA-256 hash is stored, so a copy of the database cannot be used to claim a
// job. Nothing here logs a key or a hash.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

export const newDeviceKey = () => randomBytes(32).toString('base64url')

export const hashKey = (key: string) => createHash('sha256').update(key, 'utf8').digest('hex')

/** 32 bytes as base64url is 43 characters. Anything else is not a key and is not looked up. */
export const looksLikeKey = (key: string) => /^[A-Za-z0-9_-]{43}$/.test(key)

/** Compares two hex hashes in constant time. */
export function sameHash(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex')
  const right = Buffer.from(b, 'hex')
  return left.length === 32 && right.length === 32 && timingSafeEqual(left, right)
}
