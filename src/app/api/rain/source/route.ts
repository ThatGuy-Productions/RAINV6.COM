import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { withTierGate } from '@/lib/rain/tier-gate'
import { buildServerZip, type ZipFile } from '@/lib/rain/server-zip'

export const runtime = 'nodejs'
// Building the source archive walks the filesystem — never cache it.
export const dynamic = 'force-dynamic'

/**
 * GET /api/rain/source
 *
 * Enterprise-only. Streams a real ZIP archive of the runnable project source
 * (src/, prisma/, public/logo.svg, config files). Powers the Export tab's
 * "Download Full Source ZIP" affordance for Enterprise admins.
 *
 * Excludes: node_modules, .next, .git, db/*.db, the bundled public zips, and
 * any other large/binary/generated artifacts so the archive stays small and
 * honest (source-only, exactly what the release notes describe).
 */
const PROJECT_ROOT = process.cwd()

// Directories to include (recursively), relative to project root.
const INCLUDE_DIRS = ['src', 'prisma']
// Individual files to include from the project root.
const INCLUDE_FILES = [
  'package.json',
  'tsconfig.json',
  'next.config.ts',
  'tailwind.config.ts',
  'postcss.config.mjs',
  'components.json',
  'eslint.config.mjs',
  'Caddyfile',
  '.env.example',
]

// Directory/file basenames to skip while walking.
const SKIP_NAMES = new Set([
  'node_modules',
  '.next',
  '.git',
  '.turbo',
  'out',
  'build',
  '.cache',
])

// File basenames / extensions to skip (binaries, DBs, archives, logs).
function shouldSkipFile(name: string): boolean {
  if (SKIP_NAMES.has(name)) return true
  if (name.endsWith('.db')) return true
  if (name.endsWith('.db-journal')) return true
  if (name.endsWith('.zip')) return true
  if (name.endsWith('.log')) return true
  if (name.endsWith('.png') && name !== 'logo.svg') return true // skip heavy screenshots
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return true
  if (name.endsWith('.webp')) return true
  if (name.endsWith('.mp4') || name.endsWith('.webm')) return true
  if (name.endsWith('.wav') || name.endsWith('.mp3')) return true
  return false
}

async function walkDir(dirAbs: string): Promise<string[]> {
  const { readdir } = await import('node:fs/promises')
  const out: string[] = []
  let entries: Awaited<ReturnType<typeof readdir>>
  try {
    entries = await readdir(dirAbs, { withFileTypes: true })
  } catch {
    return out
  }
  for (const ent of entries) {
    if (SKIP_NAMES.has(ent.name)) continue
    const full = join(dirAbs, ent.name)
    if (ent.isDirectory()) {
      out.push(...(await walkDir(full)))
    } else if (ent.isFile()) {
      if (shouldSkipFile(ent.name)) continue
      out.push(full)
    }
  }
  return out
}

export async function GET(req: NextRequest) {
  const gate = await withTierGate(req, 'enterprise')
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.error, required: gate.required, current: gate.current },
      { status: gate.status },
    )
  }

  try {
    const files: ZipFile[] = []

    // 1. Recursively include the code directories.
    for (const dir of INCLUDE_DIRS) {
      const dirAbs = join(PROJECT_ROOT, dir)
      const paths = await walkDir(dirAbs)
      for (const p of paths) {
        const rel = relative(PROJECT_ROOT, p).split(sep).join('/')
        const data = await readFile(p)
        files.push({ name: rel, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
      }
    }

    // 2. Include root-level config files (only those that exist).
    for (const f of INCLUDE_FILES) {
      try {
        const data = await readFile(join(PROJECT_ROOT, f))
        files.push({ name: f, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
      } catch {
        // file not present — skip silently
      }
    }

    // 3. Include the README + release notes if present.
    for (const extra of ['README.md', 'BETA_RELEASE_NOTES.md', 'LICENSE']) {
      try {
        const data = await readFile(join(PROJECT_ROOT, extra))
        files.push({ name: extra, data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength) })
      } catch {
        // optional
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: 'No source files found' }, { status: 500 })
    }

    const zipBytes = buildServerZip(files)

    return new NextResponse(zipBytes as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="rain-v6-source.zip"`,
        'Content-Length': String(zipBytes.length),
        'Cache-Control': 'no-store',
        'X-File-Count': String(files.length),
      },
    })
  } catch (err) {
    console.error('[source] failed:', err)
    return NextResponse.json(
      { error: 'Failed to build source archive' },
      { status: 500 },
    )
  }
}
