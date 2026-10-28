/**
 * Stem separation capability — product goal remains 12-stem neural cascade.
 * Reports neural when pass-1 weights verify; otherwise reports installing.
 */

import { resolvePass1Backend, listVerifiedStemModels } from '@/lib/rain/stems-model-registry'

export type StemsMode = 'neural' | 'installing' | 'spectral_fill'

export interface StemsCapability {
  mode: StemsMode
  tabDescription: string
  userMessage: string
  pipelineNote: string
  canClaimNeural: boolean
  pass1Backend: string | null
  verifiedModelCount: number
}

export async function getStemsCapabilityAsync(): Promise<StemsCapability> {
  const pass1 = await resolvePass1Backend()
  const verified = await listVerifiedStemModels()

  if (pass1) {
    return {
      mode: 'neural',
      tabDescription: `12-stem cascade (${pass1.name})`,
      userMessage: `Pass-1 neural backend ready: ${pass1.name}. Full cascade runs BS-RoFormer/Demucs → vocal split → drum split → residual.`,
      pipelineNote: `Neural source separation: ${pass1.id}`,
      canClaimNeural: true,
      pass1Backend: pass1.id,
      verifiedModelCount: verified.length,
    }
  }

  return {
    mode: 'installing',
    tabDescription: '12-stem cascade (install BS-RoFormer or Demucs weights)',
    userMessage:
      'Product target remains 4-pass 12-stem separation. Install BS-RoFormer (preferred) or Demucs htdemucs_6s ONNX under public/models/stems/ — see docs/stems/INSTALL-MODELS.md.',
    pipelineNote: 'Awaiting pass-1 neural weights (BS-RoFormer or Demucs)',
    canClaimNeural: false,
    pass1Backend: null,
    verifiedModelCount: verified.length,
  }
}

/** Sync snapshot for static UI (does not probe network). */
export function getStemsCapability(): StemsCapability {
  return {
    mode: 'installing',
    tabDescription: '12-stem BS-RoFormer cascade (weights installable)',
    userMessage:
      'RAIN targets a 4-pass 12-stem neural cascade (BS-RoFormer preferred, Demucs fallback). Place verified ONNX weights under public/models/stems/.',
    pipelineNote: '12-stem cascade architecture ready; install pass-1 weights to enable neural inference',
    canClaimNeural: false,
    pass1Backend: null,
    verifiedModelCount: 0,
  }
}
