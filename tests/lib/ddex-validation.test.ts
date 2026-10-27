import { describe, expect, it } from 'bun:test'
import { buildDdexErnXml, validateDdex } from '../../src/lib/rain/distribution'

const metadata = {
  title: 'Unit Test Track',
  artist: 'Unit Test Artist',
  album: 'Test Release',
  genre: 'Pop',
  year: '2026',
  isrc: 'USABC2600001',
  upc: '012345678905',
  senderDpid: 'PADPIDA2025010100A',
  recipientDpid: 'PADPIDA2014120301U',
  audioResource: { filename: 'assets/Unit_Test_Track.wav', sha256: 'ab'.repeat(32), hashSumBase64: btoa(String.fromCharCode(...new Uint8Array(32).fill(0xab))), channels: 2, sampleRate: 48000, bitDepth: 24, sizeBytes: 12345 },
  releaseDate: '2026-10-27',
  releaseType: 'single' as const,
  label: 'Test Label',
  distributor: 'RAIN V6',
  pLine: '2026 Unit Test Artist',
  cLine: '2026 Unit Test Artist',
  language: 'eng',
  explicitLyrics: 'none' as const,
  parentalAdvisory: false,
  territories: ['WORLDWIDE'],
  durationSeconds: 180,
  aiDisclosure: {
    vocals: 'none' as const,
    instrumentation: 'none' as const,
    composition: 'none' as const,
    mixing: 'none' as const,
    mastering: 'assisted' as const,
  },
  targetDsps: ['spotify'],
  dspLabels: { spotify: 'Spotify' },
}

describe('DDEX ERN XML validation', () => {
  it('builds well-formed ERN 4.3.2 XML with required release metadata', () => {
    const xml = buildDdexErnXml(metadata)
    const result = validateDdex(xml)
    expect(xml).toContain('xmlns:ern="http://ddex.net/xml/ern/432"')
    expect(xml).toContain('AvsVersionId="4"')
    expect(xml).toContain('<ICPN>012345678905</ICPN>')
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
  })

  it('rejects malformed XML', () => {
    expect(validateDdex('<ern:NewReleaseMessage><broken></ern:NewReleaseMessage>').ok).toBe(false)
  })

  it('rejects missing required ERN elements', () => {
    const result = validateDdex('<NewReleaseMessage><MessageHeader /></NewReleaseMessage>')
    expect(result.ok).toBe(false)
    expect(result.errors.some((error) => error.includes('Missing required element'))).toBe(true)
  })
})
