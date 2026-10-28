/**
 * Stem separation capability truth.
 *
 * ENGINEERING-FIX-PLAN W7: do not relabel DSP approximations as neural
 * separation. Only advertise BS-RoFormer / 12-stem neural when the feature
 * flag is on and a verified model is present.
 */

import { isNeuralStemsEnabled } from '@/lib/rain/feature-flags'

export type StemsMode = 'unavailable' | 'heuristic' | 'neural'

export interface StemsCapability {
  mode: StemsMode
  /** Safe short label for tabs and UI. */
  tabDescription: string
  /** Longer status for users. */
  userMessage: string
  /** Pipeline stage status text. */
  pipelineNote: string
  canClaimNeural: boolean
}

export function getStemsCapability(): StemsCapability {
  if (isNeuralStemsEnabled()) {
    return {
      mode: 'neural',
      tabDescription: '12-stem neural separation (verified model)',
      userMessage: 'Neural stem separation is enabled for this build.',
      pipelineNote: 'Neural source separation enabled by feature flag',
      canClaimNeural: true,
    }
  }

  return {
    mode: 'unavailable',
    tabDescription: 'Stems (neural model not enabled in this build)',
    userMessage:
      'Neural 12-stem separation is not enabled. This build does not claim BS-RoFormer output. A licensed, verified model must be shipped before this feature is advertised.',
    pipelineNote: 'Skipped: licensed, verified neural model not bundled',
    canClaimNeural: false,
  }
}
