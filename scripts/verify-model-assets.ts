import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

type ModelManifest = {
  modelName: string
  externalDataFile: string
  checksums: {
    sha256: string
    sha256ExternalData: string
  }
}

const modelDir = join(process.cwd(), 'public', 'models')
const manifests = ['rain_base.manifest.json', 'rain_trained.manifest.json']

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

async function verify(manifestFile: string): Promise<void> {
  const manifestPath = join(modelDir, manifestFile)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as ModelManifest

  for (const [assetName, expected] of [
    [manifest.modelName, manifest.checksums?.sha256],
    [manifest.externalDataFile, manifest.checksums?.sha256ExternalData],
  ] as const) {
    if (!assetName || !/^[a-f0-9]{64}$/i.test(expected ?? '')) {
      throw new Error(`${manifestFile}: missing or malformed SHA-256 for ${assetName || 'unnamed asset'}`)
    }

    const path = join(modelDir, assetName)
    const bytes = await readFile(path)
    const prefix = Buffer.from('version https://git-lfs.github.com/spec/v1')
    if (bytes.subarray(0, prefix.length).equals(prefix)) {
      throw new Error(`${path} is a Git LFS pointer, not the actual model asset. Ensure checkout uses lfs: true.`)
    }

    const actual = sha256(bytes)
    if (actual !== expected.toLowerCase()) {
      throw new Error(`${path} SHA-256 mismatch: expected ${expected}, got ${actual}`)
    }
    console.log(`Verified ${assetName} (${bytes.byteLength.toLocaleString()} bytes, SHA-256 ${actual})`)
  }
}

for (const manifest of manifests) {
  await verify(manifest)
}
console.log('All RainNet model assets verified.')
