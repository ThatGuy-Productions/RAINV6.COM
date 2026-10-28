/**
 * Stem separation model registry — 4-pass / 12-stem cascade.
 *
 * Product target (unchanged):
 *   Pass 1: BS-RoFormer (or Demucs htdemucs_6s) → vocals, drums, bass, guitar, piano, other
 *   Pass 2: Vocal split → lead_vocals, backing_vocals
 *   Pass 3: Drum split → kick, snare, hats, percussion
 *   Pass 4: Residual → ambience, other
 *
 * Preferred neural stack: BS-RoFormer family.
 * Open fallback: Demucs (MIT) ONNX when RoFormer weights are not yet licensed/bundled.
 */

export type StemBackendId = 'bs_roformer' | 'demucs_htdemucs_6s' | 'melband_karaoke' | 'drum_cascade' | 'residual'

export interface StemModelSpec {
  id: StemBackendId
  /** Human label */
  name: string
  /** Relative to site origin, e.g. /models/stems/... */
  onnxPath: string
  /** Optional external data file for large weights */
  dataPath?: string
  manifestPath: string
  /** Expected sample rate for model input */
  sampleRate: number
  /** Ordered output stem names produced by this model */
  outputs: string[]
  /** License note for operators */
  license: string
  /** Which cascade pass this model serves */
  pass: 1 | 2 | 3 | 4
}

/** Canonical 12 product stems after all four passes. */
export const PRODUCT_STEM_KEYS = [
  'vocals',
  'backing_vocals',
  'drums',
  'bass',
  'guitar',
  'piano',
  'kick',
  'snare',
  'hats',
  'percussion',
  'ambience',
  'other',
] as const

export type ProductStemKey = (typeof PRODUCT_STEM_KEYS)[number]

export const STEM_MODELS: readonly StemModelSpec[] = [
  {
    id: 'bs_roformer',
    name: 'BS-RoFormer (6-stem)',
    onnxPath: '/models/stems/bs_roformer_6s.onnx',
    dataPath: '/models/stems/bs_roformer_6s.onnx.data',
    manifestPath: '/models/stems/bs_roformer_6s.manifest.json',
    sampleRate: 44100,
    outputs: ['vocals', 'drums', 'bass', 'guitar', 'piano', 'other'],
    license: 'Requires licensed/redistributable BS-RoFormer weights for production bundling.',
    pass: 1,
  },
  {
    id: 'demucs_htdemucs_6s',
    name: 'Demucs HTDemucs 6s (open fallback)',
    onnxPath: '/models/stems/htdemucs_6s.onnx',
    dataPath: '/models/stems/htdemucs_6s.onnx.data',
    manifestPath: '/models/stems/htdemucs_6s.manifest.json',
    sampleRate: 44100,
    outputs: ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'],
    license: 'Demucs MIT — preferred open fallback until BS-RoFormer weights are available.',
    pass: 1,
  },
  {
    id: 'melband_karaoke',
    name: 'MelBand karaoke vocal split',
    onnxPath: '/models/stems/melband_karaoke.onnx',
    dataPath: '/models/stems/melband_karaoke.onnx.data',
    manifestPath: '/models/stems/melband_karaoke.manifest.json',
    sampleRate: 44100,
    outputs: ['lead_vocals', 'backing_vocals'],
    license: 'Requires redistributable karaoke/MelBand checkpoint.',
    pass: 2,
  },
  {
    id: 'drum_cascade',
    name: 'Drum cascade (kick/snare/hats/perc)',
    onnxPath: '/models/stems/drumsep.onnx',
    dataPath: '/models/stems/drumsep.onnx.data',
    manifestPath: '/models/stems/drumsep.manifest.json',
    sampleRate: 44100,
    outputs: ['kick', 'snare', 'hats', 'percussion'],
    license: 'Optional specialized drum model; spectral band-split used if absent.',
    pass: 3,
  },
  {
    id: 'residual',
    name: 'Residual / ambience',
    onnxPath: '/models/stems/residual_ambience.onnx',
    dataPath: '/models/stems/residual_ambience.onnx.data',
    manifestPath: '/models/stems/residual_ambience.manifest.json',
    sampleRate: 44100,
    outputs: ['ambience', 'other'],
    license: 'Optional; residual subtraction used if absent.',
    pass: 4,
  },
] as const

export interface StemManifest {
  modelName: string
  schemaVersion: number
  externalDataFile?: string
  checksums: {
    sha256: string
    sha256ExternalData?: string
  }
  sampleRate?: number
  outputs?: string[]
}

function isSha256Hex(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value)
}

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function probeStemModel(spec: StemModelSpec): Promise<{
  present: boolean
  verified: boolean
  reason?: string
}> {
  try {
    const manifestRes = await fetch(spec.manifestPath, { cache: 'no-store' })
    if (!manifestRes.ok) {
      return { present: false, verified: false, reason: `manifest missing (${manifestRes.status})` }
    }
    const manifest = (await manifestRes.json()) as StemManifest
    if (!isSha256Hex(manifest.checksums?.sha256)) {
      return { present: true, verified: false, reason: 'manifest checksum invalid' }
    }

    const onnxRes = await fetch(spec.onnxPath, { cache: 'no-store' })
    if (!onnxRes.ok) {
      return { present: false, verified: false, reason: `onnx missing (${onnxRes.status})` }
    }
    const onnxBuf = await onnxRes.arrayBuffer()
    // Skip full hash on huge files if Content-Length already tiny (pointer) — still hash.
    const onnxHash = await sha256Hex(onnxBuf)
    if (onnxHash.toLowerCase() !== manifest.checksums.sha256.toLowerCase()) {
      return { present: true, verified: false, reason: 'onnx sha256 mismatch' }
    }

    if (spec.dataPath && manifest.checksums.sha256ExternalData) {
      const dataRes = await fetch(spec.dataPath, { cache: 'no-store' })
      if (!dataRes.ok) {
        return { present: false, verified: false, reason: 'external data missing' }
      }
      const dataBuf = await dataRes.arrayBuffer()
      const dataHash = await sha256Hex(dataBuf)
      if (dataHash.toLowerCase() !== manifest.checksums.sha256ExternalData.toLowerCase()) {
        return { present: true, verified: false, reason: 'external data sha256 mismatch' }
      }
    }

    return { present: true, verified: true }
  } catch (err) {
    return {
      present: false,
      verified: false,
      reason: err instanceof Error ? err.message : 'probe failed',
    }
  }
}

/** Resolve pass-1 backend: BS-RoFormer first, then Demucs. */
export async function resolvePass1Backend(): Promise<StemModelSpec | null> {
  const preferred = STEM_MODELS.filter((m) => m.pass === 1)
  // Prefer BS-RoFormer order as listed, then Demucs.
  for (const spec of preferred) {
    const probe = await probeStemModel(spec)
    if (probe.verified) return spec
  }
  return null
}

export async function listVerifiedStemModels(): Promise<StemModelSpec[]> {
  const out: StemModelSpec[] = []
  for (const spec of STEM_MODELS) {
    const probe = await probeStemModel(spec)
    if (probe.verified) out.push(spec)
  }
  return out
}
