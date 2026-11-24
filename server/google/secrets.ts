// The two things GOOGLE_TOKEN_KEY protects:
//
//   * a refresh token at rest: AES-256-GCM, a fresh 12-byte nonce each time,
//     bound to the user it belongs to, so a value copied to another row does
//     not decrypt;
//   * the `state` of a sign-in with Google: signed, good for ten minutes, tied
//     to the person who started it and to a one-time cookie in their browser.
//
// Pure functions of the key they are given. Nothing here logs anything.

import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto'

/** How long a person has to finish Google's consent screen. */
export const STATE_SECONDS = 600

/**
 * 32 bytes from the setting: 32 random bytes as base64, or as 64 hex
 * characters. Other text is accepted only when it is at least 32 characters
 * long (it is hashed); anything shorter is refused, so a short word can never
 * become the key.
 */
function keyBytes(key: string): Buffer {
  if (!key) throw new Error('GOOGLE_TOKEN_KEY is not set.')
  if (/^[0-9a-f]{64}$/i.test(key)) return Buffer.from(key, 'hex')
  const decoded = Buffer.from(key, 'base64')
  if (decoded.length === 32 && /^[A-Za-z0-9+/_-]+={0,2}$/.test(key)) return decoded
  if (key.length < 32) throw new Error('GOOGLE_TOKEN_KEY is too short. Use 32 random bytes: `openssl rand -base64 32`.')
  return createHash('sha256').update(key, 'utf8').digest()
}

/** A separate key for each use, so a signature can never be mistaken for a ciphertext. */
const subKey = (key: string, use: string) => Buffer.from(hkdfSync('sha256', keyBytes(key), Buffer.alloc(0), `platinum-google-${use}`, 32))

const b64 = (bytes: Buffer) => bytes.toString('base64url')

// ── Refresh tokens ──────────────────────────────────────────────────────────

/** `v1.<nonce>.<tag>.<ciphertext>`. */
export function encryptToken(plain: string, userId: string, key: string): string {
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', subKey(key, 'token'), nonce, { authTagLength: 16 })
  cipher.setAAD(Buffer.from(userId, 'utf8'))
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', b64(nonce), b64(cipher.getAuthTag()), b64(body)].join('.')
}

/** Throws when the value was changed, belongs to another user, or was made with another key. */
export function decryptToken(stored: string, userId: string, key: string): string {
  const [version, nonce, tag, body] = stored.split('.')
  if (version !== 'v1' || !nonce || !tag || !body) throw new Error('The stored Google token is not in a known form.')
  const nonceBytes = Buffer.from(nonce, 'base64url')
  const tagBytes = Buffer.from(tag, 'base64url')
  // A shortened tag is a weaker check: only the full 16 bytes, and the 12-byte nonce we make, are accepted.
  if (nonceBytes.length !== 12 || tagBytes.length !== 16) throw new Error('The stored Google token is not in a known form.')
  const decipher = createDecipheriv('aes-256-gcm', subKey(key, 'token'), nonceBytes, { authTagLength: 16 })
  decipher.setAAD(Buffer.from(userId, 'utf8'))
  decipher.setAuthTag(tagBytes)
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8')
}

// ── State ───────────────────────────────────────────────────────────────────

export interface StateClaims {
  userId: string
  firmId: string
  /** The consent asked for sending from Gmail as well. */
  gmail: boolean
}

const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('base64url')

/** A one-time value kept in the browser as a cookie while the person is at Google. */
export const newNonce = () => randomBytes(24).toString('base64url')

export function signState(claims: StateClaims, nonce: string, key: string, now = Date.now()): string {
  const payload = b64(Buffer.from(JSON.stringify({ u: claims.userId, f: claims.firmId, g: claims.gmail, e: Math.floor(now / 1000) + STATE_SECONDS, n: sha(nonce) }), 'utf8'))
  return `${payload}.${b64(createHmac('sha256', subKey(key, 'state')).update(payload).digest())}`
}

/**
 * The claims of a state, or undefined when it is not ours, was changed, has
 * expired, or did not start in this browser (the cookie's value must match).
 */
export function verifyState(state: string | null | undefined, nonce: string | null | undefined, key: string, now = Date.now()): StateClaims | undefined {
  if (!state || !nonce) return undefined
  const [payload, signature, extra] = state.split('.')
  if (!payload || !signature || extra !== undefined) return undefined
  const expected = createHmac('sha256', subKey(key, 'state')).update(payload).digest()
  const given = Buffer.from(signature, 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { u?: unknown; f?: unknown; g?: unknown; e?: unknown; n?: unknown }
    if (typeof claims.u !== 'string' || typeof claims.f !== 'string' || typeof claims.e !== 'number' || typeof claims.n !== 'string') return undefined
    if (claims.e * 1000 <= now) return undefined
    const want = Buffer.from(claims.n)
    const have = Buffer.from(sha(nonce))
    if (want.length !== have.length || !timingSafeEqual(want, have)) return undefined
    return { userId: claims.u, firmId: claims.f, gmail: claims.g === true }
  } catch {
    return undefined
  }
}
