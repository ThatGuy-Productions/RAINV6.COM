/**
 * ONNX Runtime Web loader for stem separation models.
 * WebGPU preferred, WASM fallback — same pattern as RainNet.
 */

import type { InferenceSession, Tensor } from 'onnxruntime-web'
import type { StemModelSpec } from '@/lib/rain/stems-model-registry'

let ortModule: typeof import('onnxruntime-web') | null = null

async function loadOrt() {
  if (!ortModule) {
    ortModule = await import('onnxruntime-web')
    // WASM paths — Next serves from node_modules via bundler; override if needed.
    if (ortModule.env?.wasm) {
      ortModule.env.wasm.numThreads = Math.min(4, typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 2 : 2)
    }
  }
  return ortModule
}

const sessionCache = new Map<string, InferenceSession>()

export async function getStemSession(spec: StemModelSpec): Promise<InferenceSession> {
  const cached = sessionCache.get(spec.id)
  if (cached) return cached

  const ort = await loadOrt()
  const providers: string[] = []
  // Try WebGPU then WASM
  try {
    // @ts-expect-error webgpu may not be in older types
    if (typeof navigator !== 'undefined' && navigator.gpu) providers.push('webgpu')
  } catch {
    /* ignore */
  }
  providers.push('wasm')

  const session = await ort.InferenceSession.create(spec.onnxPath, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
  })
  sessionCache.set(spec.id, session)
  return session
}

export async function runStemModel(
  spec: StemModelSpec,
  inputName: string,
  inputTensor: Tensor,
): Promise<Record<string, Tensor>> {
  const session = await getStemSession(spec)
  const feeds: Record<string, Tensor> = { [inputName]: inputTensor }
  // If model uses a different primary input name, try first input metadata.
  if (!session.inputNames.includes(inputName) && session.inputNames[0]) {
    feeds[session.inputNames[0]] = inputTensor
    delete feeds[inputName]
  }
  return session.run(feeds)
}

export function disposeStemSessions(): void {
  sessionCache.clear()
}
