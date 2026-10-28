import { describe, expect, it } from 'bun:test'
import { createProvenanceSigningPayload, verifyProvenance } from '../../src/lib/rain/provenance'
import type { ProvenanceCertificate } from '../../src/lib/rain/types'

async function signedCertificate(): Promise<ProvenanceCertificate> {
  const manifest = {
    version: '2.2',
    claimGenerator: 'RAIN/6.0.0-test',
    actions: [{ action: 'c2pa.audio.mastered', parameters: { engine: 'test' }, when: '2026-10-27T00:00:00.000Z' }],
    assertions: [
      { label: 'org.rain.cert.level', data: { level: 'RAIN-CERT-1', algorithm: 'Ed25519' } },
      { label: 'org.rain.cert.signature-payload', data: { version: 2, fields: ['algorithm', 'certId', 'inputHash', 'manifest', 'outputHash', 'signedAt', 'wasmHash'] } },
    ],
  }
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const unsigned = {
    certId: 'RAIN-CERT-TEST',
    inputHash: 'cd'.repeat(32),
    outputHash: 'ab'.repeat(32),
    wasmHash: 'rain-dsp-ts-v6:test',
    signedAt: '2026-10-27T00:00:00.000Z',
    algorithm: 'Ed25519' as const,
    manifest,
  }
  const message = createProvenanceSigningPayload(unsigned)
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, message))
  const signature = Array.from(signatureBytes, byte => byte.toString(16).padStart(2, '0')).join('')

  return {
    ...unsigned,
    publicKey: btoa(JSON.stringify(jwk)),
    signature,
  } as ProvenanceCertificate
}

async function legacySignedCertificate(): Promise<ProvenanceCertificate> {
  const manifest = {
    version: '2.2',
    claimGenerator: 'RAIN/6.0.0-legacy-test',
    actions: [],
    assertions: [{ label: 'org.rain.cert.level', data: { level: 'RAIN-CERT-1', algorithm: 'Ed25519' } }],
  }
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const outputHash = '12'.repeat(32)
  const message = new TextEncoder().encode(outputHash + JSON.stringify(manifest))
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, message))
  return {
    certId: 'RAIN-CERT-LEGACY',
    inputHash: '34'.repeat(32),
    outputHash,
    wasmHash: 'legacy-engine',
    signedAt: '2026-10-01T00:00:00.000Z',
    algorithm: 'Ed25519',
    publicKey: btoa(JSON.stringify(jwk)),
    signature: Array.from(signatureBytes, byte => byte.toString(16).padStart(2, '0')).join(''),
    manifest,
  } as ProvenanceCertificate
}

describe('RAIN-CERT independent signature verification', () => {
  it('accepts a valid Ed25519 signature from the embedded public key', async () => {
    expect(await verifyProvenance(await signedCertificate())).toBe(true)
  })

  it('continues to verify legacy certificates using the previous signed payload', async () => {
    expect(await verifyProvenance(await legacySignedCertificate())).toBe(true)
  })

  it('rejects a modified manifest', async () => {
    const cert = await signedCertificate()
    cert.manifest.actions[0].parameters.engine = 'tampered-engine'
    expect(await verifyProvenance(cert)).toBe(false)
  })

  it('rejects a modified output hash', async () => {
    const cert = await signedCertificate()
    cert.outputHash = 'ef'.repeat(32)
    expect(await verifyProvenance(cert)).toBe(false)
  })

  it('rejects modified certificate metadata', async () => {
    const fields: Array<'certId' | 'inputHash' | 'wasmHash' | 'signedAt' | 'algorithm'> = [
      'certId', 'inputHash', 'wasmHash', 'signedAt', 'algorithm',
    ]
    for (const field of fields) {
      const cert = await signedCertificate()
      if (field === 'certId') cert.certId = 'RAIN-CERT-FORGED'
      if (field === 'inputHash') cert.inputHash = '01'.repeat(32)
      if (field === 'wasmHash') cert.wasmHash = 'forged-engine'
      if (field === 'signedAt') cert.signedAt = '2020-01-01T00:00:00.000Z'
      if (field === 'algorithm') cert.algorithm = 'RS256' as ProvenanceCertificate['algorithm']
      expect(await verifyProvenance(cert)).toBe(false)
    }
  })

  it('rejects malformed signatures and public keys without throwing', async () => {
    const cert = await signedCertificate()
    cert.signature = 'not-hex'
    expect(await verifyProvenance(cert)).toBe(false)
    cert.signature = '00'.repeat(64)
    cert.publicKey = 'not-base64-json'
    expect(await verifyProvenance(cert)).toBe(false)
  })
})
