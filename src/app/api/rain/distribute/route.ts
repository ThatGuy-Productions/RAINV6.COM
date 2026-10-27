import { createHash } from 'node:crypto'
import { unzipSync } from 'fflate'
import { verifyProvenance } from '@/lib/rain/provenance'
import type { ProvenanceCertificate } from '@/lib/rain/types'
import { NextRequest, NextResponse } from 'next/server'
import { withCsrf } from '@/lib/rain/csrf'
import { validateIsrc, validateUpc } from '@/lib/rain/metadata-validation'

export const runtime = 'nodejs'
export const maxDuration = 60

interface ReleaseManifestInput {
  releaseId?: unknown
  isrc?: unknown
  upc?: unknown
  title?: unknown
  artist?: unknown
  genre?: unknown
  releaseDate?: unknown
  provenance?: unknown
  ddexVersion?: unknown
  assets?: unknown
}

/**
 * POST /api/rain/distribute
 *
 * Validates the submitted manifest and exact ZIP bytes before forwarding them
 * to LabelGrid. Provider success is reported only after a real 2xx response.
 * The client-supplied package SHA-256 binds the locally built package to the
 * exact bytes submitted; it is not a substitute for the client's internal
 * asset-hash validation or an independent provider receipt.
 */
export const POST = withCsrf(async (req: NextRequest) => {
  let form: FormData
  try {
    form = await req.formData()
  } catch (error) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: `Invalid multipart body: ${error instanceof Error ? error.message : 'parse error'}` },
      { status: 400 },
    )
  }

  const jobId = form.get('jobId')
  const manifestText = form.get('manifest')
  const pkg = form.get('package')
  const packageSha256 = form.get('packageSha256')

  if (pkg instanceof Blob && pkg.size > 200 * 1024 * 1024) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Package exceeds the 200 MB upload limit' },
      { status: 413 },
    )
  }

  if (
    typeof jobId !== 'string' ||
    !jobId.trim() ||
    typeof manifestText !== 'string' ||
    !(pkg instanceof Blob) ||
    typeof packageSha256 !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(packageSha256)
  ) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Missing or invalid multipart fields (jobId, manifest, package, packageSha256)' },
      { status: 400 },
    )
  }

  let manifest: ReleaseManifestInput
  try {
    manifest = JSON.parse(manifestText) as ReleaseManifestInput
  } catch {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Manifest is not valid JSON' },
      { status: 400 },
    )
  }

  if (
    typeof manifest.releaseId !== 'string' ||
    !manifest.releaseId.trim() ||
    typeof manifest.title !== 'string' ||
    !manifest.title.trim() ||
    typeof manifest.artist !== 'string' ||
    !manifest.artist.trim() ||
    typeof manifest.genre !== 'string' ||
    !manifest.genre.trim() ||
    typeof manifest.releaseDate !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(manifest.releaseDate) ||
    !manifest.provenance || typeof manifest.provenance !== 'object' ||
    manifest.ddexVersion !== '4.3.2' ||
    typeof manifest.isrc !== 'string' ||
    !validateIsrc(manifest.isrc) ||
    manifest.isrc.replace(/[-\s]/g, '').toUpperCase().startsWith('US2XX') ||
    typeof manifest.upc !== 'string' ||
    !validateUpc(manifest.upc) ||
    !Array.isArray(manifest.assets) ||
    manifest.assets.length === 0
  ) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Manifest validation failed: require real release metadata, valid registered identifiers, DDEX ERN 4.3.2, and asset records' },
      { status: 422 },
    )
  }

  const certificate = manifest.provenance as ProvenanceCertificate
  if (
    typeof certificate.certId !== 'string' ||
    typeof certificate.signature !== 'string' ||
    !/^[a-f0-9]{128}$/i.test(certificate.signature) ||
    typeof certificate.inputHash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(certificate.inputHash) ||
    typeof certificate.outputHash !== 'string' ||
    !/^[a-f0-9]{64}$/i.test(certificate.outputHash) ||
    !await verifyProvenance(certificate)
  ) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'RAIN-CERT signature or hash validation failed' },
      { status: 422 },
    )
  }

  const assetsValid = manifest.assets.every((asset) => {
    if (!asset || typeof asset !== 'object') return false
    const item = asset as Record<string, unknown>
    return (
      typeof item.filename === 'string' &&
      item.filename.length > 0 &&
      !item.filename.startsWith('/') &&
      !item.filename.split('/').includes('..') &&
      typeof item.mimeType === 'string' &&
      typeof item.sizeBytes === 'number' &&
      Number.isSafeInteger(item.sizeBytes) &&
      item.sizeBytes >= 0 &&
      typeof item.sha256 === 'string' &&
      /^[a-f0-9]{64}$/i.test(item.sha256)
    )
  })
  if (!assetsValid) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Manifest contains invalid asset records or hashes' },
      { status: 422 },
    )
  }

  const packageBytes = Buffer.from(await pkg.arrayBuffer())
  const actualPackageSha256 = createHash('sha256').update(packageBytes).digest('hex')
  if (actualPackageSha256 !== packageSha256.toLowerCase()) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Package SHA-256 does not match the submitted ZIP bytes' },
      { status: 422 },
    )
  }

  // Inspect the ZIP server-side rather than trusting the browser's claim that
  // its contents match the manifest. Verify the embedded manifest and every
  // declared asset byte/hash before any external provider receives the file.
  let zipEntries: Record<string, Uint8Array>
  try {
    zipEntries = unzipSync(new Uint8Array(packageBytes))
  } catch {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Submitted package is not a valid ZIP archive' },
      { status: 422 },
    )
  }

  const embeddedManifestBytes = zipEntries['manifest.json']
  const ernXmlBytes = zipEntries['ern.xml']
  const checksumsBytes = zipEntries['checksums.txt']
  if (!embeddedManifestBytes || !ernXmlBytes || !checksumsBytes) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'ZIP must contain manifest.json, ern.xml, and checksums.txt' },
      { status: 422 },
    )
  }

  try {
    const embeddedManifest = JSON.parse(new TextDecoder().decode(embeddedManifestBytes))
    if (JSON.stringify(embeddedManifest) !== JSON.stringify(manifest)) {
      return NextResponse.json(
        { ok: false, requiresCredentials: false, error: 'Embedded ZIP manifest does not match the submitted manifest' },
        { status: 422 },
      )
    }
  } catch {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'Embedded manifest.json is invalid JSON' },
      { status: 422 },
    )
  }

  const checksumLines = new Map<string, string>()
  for (const line of new TextDecoder().decode(checksumsBytes).split(/\\r?\\n/)) {
    if (!line.trim()) continue
    const match = /^([a-f0-9]{64})\s{2}(.+)$/.exec(line)
    if (!match || checksumLines.has(match[2])) {
      return NextResponse.json(
        { ok: false, requiresCredentials: false, error: 'checksums.txt contains malformed or duplicate entries' },
        { status: 422 },
      )
    }
    checksumLines.set(match[2], match[1].toLowerCase())
  }

  const digestOf = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')
  const assetRecords = manifest.assets as Array<{ filename: string; mimeType: string; sizeBytes: number; sha256: string }>
  const wavAsset = assetRecords.find((asset) => asset.mimeType === 'audio/wav')
  const mp3Asset = assetRecords.find((asset) => asset.mimeType === 'audio/mpeg')
  const containsBytes = (haystack: Uint8Array, value: string) => {
    const source = Buffer.from(haystack.buffer, haystack.byteOffset, haystack.byteLength)
    return source.includes(Buffer.from(value, 'utf8'))
  }
  const wavBytes = wavAsset ? zipEntries[wavAsset.filename] : undefined
  const mp3Bytes = mp3Asset ? zipEntries[mp3Asset.filename] : undefined
  if (
    !wavBytes ||
    !mp3Bytes ||
    !containsBytes(wavBytes, certificate.certId) ||
    !containsBytes(wavBytes, certificate.signature) ||
    !containsBytes(mp3Bytes, certificate.certId) ||
    !containsBytes(mp3Bytes, certificate.signature)
  ) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'WAV and MP3 must contain the verified RAIN-CERT identifier and signature bytes' },
      { status: 422 },
    )
  }

  const embeddedAssetsValid = assetRecords.every((asset) => {
    const bytes = zipEntries[asset.filename]
    if (!bytes || bytes.byteLength !== asset.sizeBytes) return false
    const digest = digestOf(bytes)
    return digest === asset.sha256.toLowerCase() && checksumLines.get(asset.filename) === digest
  })
  const embeddedManifestSha = digestOf(embeddedManifestBytes)
  const embeddedErnSha = digestOf(ernXmlBytes)
  if (
    !embeddedAssetsValid ||
    checksumLines.get('manifest.json') !== embeddedManifestSha ||
    checksumLines.get('ern.xml') !== embeddedErnSha
  ) {
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: 'ZIP assets, ern.xml, manifest.json, and checksums.txt do not agree' },
      { status: 422 },
    )
  }

  const apiKey = process.env.LABELGRID_API_KEY
  if (!apiKey) {
    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: true,
        error: 'LABELGRID_API_KEY is not configured. The package was validated but has not been submitted.',
      },
      { status: 409 },
    )
  }

  const apiUrl = process.env.LABELGRID_API_URL || 'https://api.labelgrid.com/v1/deliveries'
  const outForm = new FormData()
  outForm.append('jobId', jobId)
  outForm.append('manifest', manifestText)
  outForm.append('packageSha256', actualPackageSha256)
  outForm.append('package', new Blob([packageBytes], { type: 'application/zip' }), `${jobId}.zip`)

  try {
    const providerResp = await fetch(apiUrl, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: outForm,
      signal: AbortSignal.timeout(50_000),
      cache: 'no-store',
    })

    const respText = await providerResp.text()
    if (providerResp.ok) {
      return NextResponse.json({
        ok: true,
        providerResponse: respText.slice(0, 4096) || `HTTP ${providerResp.status}`,
        packageSha256: actualPackageSha256,
      })
    }

    return NextResponse.json(
      {
        ok: false,
        requiresCredentials: false,
        error: `LabelGrid returned HTTP ${providerResp.status}: ${respText.slice(0, 1024)}`,
        providerResponse: respText.slice(0, 4096),
      },
      { status: 502 },
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Network error during provider fetch'
    return NextResponse.json(
      { ok: false, requiresCredentials: false, error: `Delivery request failed: ${message}` },
      { status: 502 },
    )
  }
})
