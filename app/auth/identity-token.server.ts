import { createPublicKey, verify, type webcrypto } from 'node:crypto'

type JsonWebKey = webcrypto.JsonWebKey

/**
 * Checks the Google identity token a bound script sends with a click in the article Doc's menu
 * (`ScriptApp.getIdentityToken()`). It proves who clicked, and nothing about what they may do:
 * that is the Drive check that follows (`doc-permissions.server.ts`).
 *
 * The signature is checked against Google's own keys, the issuer is Google, the token has not
 * expired and Google verified the address. The audience is checked only against the list in
 * `DOC_MENU_TOKEN_AUDIENCES`: every Doc carries its own copy of the bound script, and a copy
 * may answer to a Cloud project of its own, so an empty list is the decided case of a token
 * whose audience cannot be pinned (#50). The Drive check then is what refuses a token issued
 * to anything else.
 *
 * Never throws. Google's keys out of reach is `unavailable`, a "don't know" the script answers
 * with its own dialog; every other failure is a refusal, which tells the caller nothing.
 */

export const GOOGLE_CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs'

const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com'])

/** The clocks of Google and of the machine may disagree by this much. */
const SKEW_SECONDS = 60

/** Google's keys are kept this long when the answer says nothing of it. */
const DEFAULT_KEYS_SECONDS = 3600

export type VerifiedIdentity = { email: string; name: string | null }

export type IdentityCheck =
  | { identity: VerifiedIdentity; status: 'verified' }
  | { status: 'refused' }
  | { status: 'unavailable' }

export type IdentityTokenVerifier = (token: string) => Promise<IdentityCheck>

type Keys = { expiresAt: number; keys: Map<string, JsonWebKey> }

function decodePart(part: string): Record<string, unknown> | null {
  try {
    let value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null
  } catch {
    return null
  }
}

function maxAgeOf(response: Response): number {
  let match = /max-age=(\d+)/.exec(response.headers.get('cache-control') ?? '')
  return match === null ? DEFAULT_KEYS_SECONDS : Number(match[1])
}

export function createIdentityTokenVerifier(options: {
  /** The accepted `aud` values. Empty accepts any audience. */
  audiences: readonly string[]
  fetch?: typeof globalThis.fetch
  /** Seconds since the epoch. */
  now?: () => number
}): IdentityTokenVerifier {
  let send = options.fetch ?? globalThis.fetch
  let seconds = options.now ?? (() => Math.floor(Date.now() / 1000))
  let cached: Keys | null = null

  async function loadKeys(): Promise<Keys | null> {
    try {
      let response = await send(GOOGLE_CERTS_URL, { signal: AbortSignal.timeout(5000) })
      if (!response.ok) {
        console.error(`[auth] Google's keys answered HTTP ${response.status}`)
        return null
      }
      let body = (await response.json()) as { keys?: unknown }
      let keys = new Map<string, JsonWebKey>()
      for (let key of Array.isArray(body.keys) ? body.keys : []) {
        if (typeof key === 'object' && key !== null && typeof key.kid === 'string') {
          keys.set(key.kid, key as JsonWebKey)
        }
      }
      return { expiresAt: seconds() + maxAgeOf(response), keys }
    } catch (error) {
      console.error(
        `[auth] Google's keys could not be fetched: ${error instanceof Error ? error.message : 'unknown'}`,
      )
      return null
    }
  }

  /* The cached keys while they are fresh and know the `kid`; otherwise one fetch, because Google
     rotates its keys and a token may name one the cache has not seen yet. */
  async function keyFor(kid: string): Promise<JsonWebKey | 'unavailable' | null> {
    if (cached !== null && cached.expiresAt > seconds() && cached.keys.has(kid)) {
      return cached.keys.get(kid) ?? null
    }
    let fresh = await loadKeys()
    if (fresh === null) return 'unavailable'
    cached = fresh
    return fresh.keys.get(kid) ?? null
  }

  return async (token) => {
    let parts = token.split('.')
    if (parts.length !== 3) return { status: 'refused' }
    let [headerPart = '', payloadPart = '', signaturePart = ''] = parts
    let header = decodePart(headerPart)
    let payload = decodePart(payloadPart)
    if (header === null || payload === null) return { status: 'refused' }
    if (header['alg'] !== 'RS256' || typeof header['kid'] !== 'string') {
      return { status: 'refused' }
    }

    let key = await keyFor(header['kid'])
    if (key === 'unavailable') return { status: 'unavailable' }
    if (key === null) return { status: 'refused' }

    let isSigned: boolean
    try {
      isSigned = verify(
        'RSA-SHA256',
        Buffer.from(`${headerPart}.${payloadPart}`),
        createPublicKey({ format: 'jwk', key }),
        Buffer.from(signaturePart, 'base64url'),
      )
    } catch {
      isSigned = false
    }
    if (!isSigned) return { status: 'refused' }

    let now = seconds()
    let expiresAt = payload['exp']
    let issuedAt = payload['iat']
    if (typeof expiresAt !== 'number' || expiresAt + SKEW_SECONDS < now) {
      return { status: 'refused' }
    }
    if (typeof issuedAt === 'number' && issuedAt - SKEW_SECONDS > now) return { status: 'refused' }
    if (typeof payload['iss'] !== 'string' || !ISSUERS.has(payload['iss'])) {
      return { status: 'refused' }
    }
    if (options.audiences.length > 0 && !options.audiences.includes(String(payload['aud']))) {
      return { status: 'refused' }
    }
    let email = payload['email']
    if (typeof email !== 'string' || email === '' || payload['email_verified'] !== true) {
      return { status: 'refused' }
    }

    let name =
      typeof payload['name'] === 'string' && payload['name'] !== '' ? payload['name'] : null
    return { identity: { email: email.toLowerCase(), name }, status: 'verified' }
  }
}
