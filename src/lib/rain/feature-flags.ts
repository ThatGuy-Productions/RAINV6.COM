/**
 * Server/client-safe feature flags for advertised capabilities.
 * Defaults are conservative: do not claim neural stems or live pay until proven.
 */

export const FEATURE_FLAGS = {
  /** Live PayFast charging — also requires getPaymentReadiness().liveEnabled. */
  livePayments: process.env.PAYFAST_LIVE_ENABLED === 'true',
  /** Neural 12-stem separation UI claims. Off until a verified model is shipped. */
  neuralStems: process.env.RAIN_FEATURE_NEURAL_STEMS === 'true',
  /** Label neural inference only when real ONNX path is selected and verified. */
  neuralInferenceLabel: process.env.RAIN_FEATURE_NEURAL_INFERENCE_LABEL === 'true',
  /** DDEX/LabelGrid live submission. */
  liveDistribution: process.env.RAIN_FEATURE_LIVE_DISTRIBUTION === 'true',
} as const

export function isNeuralStemsEnabled(): boolean {
  return FEATURE_FLAGS.neuralStems
}

export function isLivePaymentsEnabled(): boolean {
  return FEATURE_FLAGS.livePayments
}
