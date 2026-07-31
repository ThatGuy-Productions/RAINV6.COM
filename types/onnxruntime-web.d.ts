declare module 'onnxruntime-web' {
  export interface InferenceSession {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>
    inputNames: string[]
    outputNames: string[]
    release(): Promise<void>
  }

  export const InferenceSession: {
    create(path: string, options?: {
      executionProviders?: string[]
      graphOptimizationLevel?: string
    }): Promise<InferenceSession>
  }

  export class Tensor {
    constructor(type: string, data: Float32Array | Int32Array | Uint8Array | BigInt64Array | number[], dims?: number[])
    readonly type: string
    readonly dims: readonly number[]
    readonly data: Float32Array | Int32Array | Uint8Array | BigInt64Array
    readonly size: number
    dispose(): void
  }

  export interface Env {
    webgpu?: {
      init?: () => Promise<void>
    }
    wasm?: Record<string, unknown>
  }

  export const env: Env
}
