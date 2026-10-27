import { afterEach, describe, expect, it } from 'bun:test'
import { verifyModelManifest } from '../../src/lib/rain/rainnet-inference'

const originalFetch = globalThis.fetch

async function sha256(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function response(body: BodyInit, status = 200): Response {
  return new Response(body, { status })
}

afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('RainNet model integrity verification', () => {
  it('rejects placeholder or malformed hashes before fetching model bytes', async () => {
    const manifest = {
      schemaVersion: 'rain-v1',
      modelName: 'rain_base.onnx',
      checksums: { sha256: 'PLACEHOLDER-not-a-real-hash' },
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).endsWith('.manifest.json')) {
        return response(JSON.stringify(manifest), 200)
      }
      throw new Error('model bytes must not be fetched for an invalid manifest')
    }) as typeof fetch

    expect(await verifyModelManifest('/models/rain_base.manifest.json', '/models/rain_base.onnx')).toBe(false)
  })

  it('accepts only matching model and declared external-data hashes', async () => {
    const modelBytes = new TextEncoder().encode('test onnx graph bytes')
    const dataBytes = new TextEncoder().encode('test external tensor bytes')
    const manifest = {
      schemaVersion: 'rain-v1',
      modelName: 'rain_base.onnx',
      externalDataFile: 'rain_base.onnx.data',
      checksums: {
        sha256: await sha256(modelBytes),
        sha256ExternalData: await sha256(dataBytes),
      },
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('.manifest.json')) return response(JSON.stringify(manifest))
      if (path === '/models/rain_base.onnx') return response(modelBytes)
      if (path === '/models/rain_base.onnx.data') return response(dataBytes)
      return response('', 404)
    }) as typeof fetch

    expect(await verifyModelManifest('/models/rain_base.manifest.json', '/models/rain_base.onnx')).toBe(true)
  })

  it('rejects tampered model bytes', async () => {
    const modelBytes = new TextEncoder().encode('expected graph')
    const wrongBytes = new TextEncoder().encode('tampered graph')
    const dataBytes = new TextEncoder().encode('external tensor bytes')
    const manifest = {
      schemaVersion: 'rain-v1',
      modelName: 'rain_base.onnx',
      externalDataFile: 'rain_base.onnx.data',
      checksums: {
        sha256: await sha256(modelBytes),
        sha256ExternalData: await sha256(dataBytes),
      },
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('.manifest.json')) return response(JSON.stringify(manifest))
      if (path === '/models/rain_base.onnx') return response(wrongBytes)
      if (path === '/models/rain_base.onnx.data') return response(dataBytes)
      return response('', 404)
    }) as typeof fetch

    expect(await verifyModelManifest('/models/rain_base.manifest.json', '/models/rain_base.onnx')).toBe(false)
  })

  it('rejects missing external-data hash for external-data models', async () => {
    const modelBytes = new TextEncoder().encode('test onnx graph bytes')
    const manifest = {
      schemaVersion: 'rain-v1',
      modelName: 'rain_base.onnx',
      externalDataFile: 'rain_base.onnx.data',
      checksums: { sha256: await sha256(modelBytes) },
    }
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const path = String(input)
      if (path.endsWith('.manifest.json')) return response(JSON.stringify(manifest))
      if (path === '/models/rain_base.onnx') return response(modelBytes)
      throw new Error('external data must not be fetched without its checksum')
    }) as typeof fetch

    expect(await verifyModelManifest('/models/rain_base.manifest.json', '/models/rain_base.onnx')).toBe(false)
  })
})
