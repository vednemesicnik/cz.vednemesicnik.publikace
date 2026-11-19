import { generateKeyPairSync, sign } from 'node:crypto'
import * as assert from 'remix/assert'
import { describe, it } from 'remix/test'

import { createIdentityTokenVerifier, GOOGLE_CERTS_URL } from './identity-token.server.ts'

const NOW = 1_795_100_000

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const OTHER = generateKeyPairSync('rsa', { modulusLength: 2048 })

function jwk(kid: string, key = publicKey) {
  return { ...key.export({ format: 'jwk' }), alg: 'RS256', kid, use: 'sig' }
}

function part(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function token(
  claims: Record<string, unknown> = {},
  options: { alg?: string; key?: typeof privateKey; kid?: string } = {},
): string {
  let head = part({ alg: options.alg ?? 'RS256', kid: options.kid ?? 'k1', typ: 'JWT' })
  let body = part({
    aud: 'script-client',
    email: 'Jakub.Novak@vednemesicnik.test',
    email_verified: true,
    exp: NOW + 600,
    iat: NOW - 10,
    iss: 'https://accounts.google.com',
    name: 'Jakub Novák',
    ...claims,
  })
  let signature = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), options.key ?? privateKey)
  return `${head}.${body}.${signature.toString('base64url')}`
}

/** Google's keys as `keys` names them, counting the fetches. */
function certs(...keys: unknown[]) {
  let calls = { count: 0 }
  let fetch = (async (url: string | URL | Request) => {
    calls.count += 1
    assert.equal(String(url), GOOGLE_CERTS_URL)
    return new Response(JSON.stringify({ keys }), {
      headers: { 'Cache-Control': 'public, max-age=3600' },
    })
  }) as typeof globalThis.fetch
  return { calls, fetch }
}

function verifier(fetch: typeof globalThis.fetch, audiences: string[] = []) {
  return createIdentityTokenVerifier({ audiences, fetch, now: () => NOW })
}

describe('the identity token of a click in the Doc menu', () => {
  it('vouches for the address, lower-cased, and the name', async () => {
    let check = await verifier(certs(jwk('k1')).fetch)(token())
    assert.deepEqual(check, {
      identity: { email: 'jakub.novak@vednemesicnik.test', name: 'Jakub Novák' },
      status: 'verified',
    })
  })

  it('takes a token without a name, which a script without the profile scope sends', async () => {
    let check = await verifier(certs(jwk('k1')).fetch)(token({ name: undefined }))
    assert.deepEqual(check, {
      identity: { email: 'jakub.novak@vednemesicnik.test', name: null },
      status: 'verified',
    })
  })

  it('refuses a token that is not Google’s, has expired, or has no verified address', async () => {
    let verify = verifier(certs(jwk('k1')).fetch)
    let refused = { status: 'refused' }

    assert.deepEqual(await verify(token({}, { key: OTHER.privateKey })), refused)
    assert.deepEqual(await verify(token({ iss: 'https://evil.external.test' })), refused)
    assert.deepEqual(await verify(token({ exp: NOW - 120 })), refused)
    assert.deepEqual(await verify(token({ iat: NOW + 600 })), refused)
    assert.deepEqual(await verify(token({ email_verified: false })), refused)
    assert.deepEqual(await verify(token({ email: '' })), refused)
    assert.deepEqual(await verify(token({}, { alg: 'HS256' })), refused)
    assert.deepEqual(await verify('not.a-token'), refused)
    assert.deepEqual(await verify(''), refused)
  })

  it('checks the audience only against the configured list', async () => {
    let keys = certs(jwk('k1'))
    assert.equal((await verifier(keys.fetch, ['script-client'])(token())).status, 'verified')
    assert.equal((await verifier(keys.fetch, ['another-client'])(token())).status, 'refused')
    assert.equal((await verifier(keys.fetch)(token({ aud: 'anything' }))).status, 'verified')
  })

  it('fetches the keys again for a key it has not seen, and keeps them otherwise', async () => {
    let keys = certs(jwk('k1'), jwk('k2', OTHER.publicKey))
    let verify = verifier(keys.fetch)

    await verify(token())
    await verify(token())
    assert.equal(keys.calls.count, 1)

    assert.equal((await verify(token({}, { key: OTHER.privateKey, kid: 'k2' }))).status, 'verified')
    assert.equal((await verify(token({}, { kid: 'k-unknown' }))).status, 'refused')
    assert.equal(keys.calls.count, 2)
  })

  it('answers unavailable, never refused, when Google’s keys are out of reach', async (t) => {
    t.mock.method(console, 'error', () => {})
    let failing = (async () => {
      throw new TypeError('fetch failed')
    }) as typeof globalThis.fetch
    assert.deepEqual(await verifier(failing)(token()), { status: 'unavailable' })
  })
})
