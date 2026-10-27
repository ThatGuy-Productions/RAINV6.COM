import { describe, expect, it } from 'bun:test'
import { unzipSync } from 'fflate'
import { buildDistributionPackage } from '../../src/lib/rain/distribution'
import { hashFloat32Channels } from '../../src/lib/rain/provenance'
import type { ProvenanceCertificate } from '../../src/lib/rain/types'

function makeAudioBuffer(seconds = 1, sampleRate = 48000): AudioBuffer {
  const length = Math.floor(seconds * sampleRate)
  const channels = [new Float32Array(length), new Float32Array(length)]
  for (let i = 0; i < length; i++) {
    const sample = 0.2 * Math.sin(2 * Math.PI * 440 * i / sampleRate)
    channels[0][i] = sample
    channels[1][i] = sample
  }
  return {
    numberOfChannels: 2,
    sampleRate,
    length,
    duration: length / sampleRate,
    getChannelData(channel: number) {
      if (!channels[channel]) throw new RangeError('Invalid channel')
      return channels[channel]
    },
  } as unknown as AudioBuffer
}

async function makeCertificate(buffer: AudioBuffer): Promise<ProvenanceCertificate> {
  const channels = Array.from(
    { length: buffer.numberOfChannels },
    (_, channel) => buffer.getChannelData(channel),
  )
  const outputHash = await hashFloat32Channels(channels)
  const manifest = {
    version: '2.2',
    claimGenerator: 'RAIN/6.0.0-test',
    actions: [{ action: 'c2pa.audio.mastered', parameters: { engine: 'test' }, when: '2026-10-27T00:00:00.000Z' }],
    assertions: [{ label: 'org.rain.fingerprint', data: { type: 'test', hash: '0123456789abcdef' } }],
  }
  const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const publicKey = btoa(JSON.stringify(publicJwk))
  const message = new TextEncoder().encode(outputHash + JSON.stringify(manifest))
  const signatureBytes = new Uint8Array(await crypto.subtle.sign('Ed25519', pair.privateKey, message))
  const signature = Array.from(signatureBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')

  return {
    certId: 'RAIN-CERT-PACKAGE-TEST',
    inputHash: '11'.repeat(32),
    outputHash,
    wasmHash: 'rain-dsp-ts-v6:test',
    signedAt: '2026-10-27T00:00:00.000Z',
    algorithm: 'Ed25519',
    publicKey,
    signature,
    manifest,
  }
}

describe('Distribution package integration', () => {
  it('builds a checksummed ZIP with DDEX, registered-ID format, and embedded provenance', async () => {
    const buffer = makeAudioBuffer()
    const certificate = await makeCertificate(buffer)
    const result = await buildDistributionPackage(buffer, {
      title: 'Integration Test Track',
      artist: 'Integration Test Artist',
      album: 'Test Album',
      genre: 'Pop',
      year: '2026',
      isrc: 'USABC2600001',
      upc: '012345678905',
      senderDpid: 'PADPIDA2025010100A',
      recipientDpid: 'PADPIDA2014120301U',
      releaseDate: '2026-10-27',
      releaseType: 'single',
      label: 'Test Label',
      distributor: 'RAIN V6',
      pLine: '2026 Integration Test Artist',
      cLine: '2026 Integration Test Artist',
      language: 'eng',
      explicitLyrics: 'none',
      parentalAdvisory: false,
      territories: ['WORLDWIDE'],
      durationSeconds: buffer.duration,
      aiDisclosure: {
        vocals: 'none',
        instrumentation: 'none',
        composition: 'none',
        mixing: 'none',
        mastering: 'assisted',
      },
      targetDsps: ['spotify'],
      dspLabels: { spotify: 'Spotify' },
    }, certificate)

    expect(result.validation.ok).toBe(true)
    expect(result.packageSha256).toMatch(/^[a-f0-9]{64}$/)
    const zip = unzipSync(result.packageBytes)
    expect(zip['manifest.json']).toBeDefined()
    expect(zip['ern.xml']).toBeDefined()
    expect(zip['checksums.txt']).toBeDefined()

    const embeddedManifest = JSON.parse(new TextDecoder().decode(zip['manifest.json']))
    expect(embeddedManifest.provenance.certId).toBe(certificate.certId)
    expect(embeddedManifest.assets.length).toBeGreaterThanOrEqual(2)

    const checksums = new TextDecoder().decode(zip['checksums.txt'])
    expect(checksums).toContain('  ern.xml')
    expect(checksums).toContain('  manifest.json')
    for (const asset of embeddedManifest.assets) {
      const bytes = zip[asset.filename]
      expect(bytes).toBeDefined()
      expect(bytes.byteLength).toBe(asset.sizeBytes)
    }

    const wav = zip[embeddedManifest.assets.find((asset: { mimeType: string }) => asset.mimeType === 'audio/wav').filename]
    const mp3 = zip[embeddedManifest.assets.find((asset: { mimeType: string }) => asset.mimeType === 'audio/mpeg').filename]
    expect(Buffer.from(wav).includes(Buffer.from(certificate.signature))).toBe(true)
    expect(Buffer.from(mp3).includes(Buffer.from(certificate.signature))).toBe(true)
  })
})
